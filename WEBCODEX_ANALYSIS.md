# WebCodex 项目深度分析与安全评估报告

## 一、项目概述与整体架构

WebCodex 是一个自托管（Self-hosted）的 AI 辅助编程桥接工具。它的核心目标是让 ChatGPT、Claude 或其他 AI 客户端能够**直接在开发者自己的本地电脑或云服务器上**安全地读取代码、修改文件、运行测试、执行 Git 操作及 Shell 命令，而**无需将私有代码库上传或导入到第三方 AI 平台的云端环境**。

### 核心架构组成

```text
  ┌─────────────────────────┐
  │  AI Client (ChatGPT)    │
  └────────────┬────────────┘
               │  MCP / HTTPS / OpenAPI
               ▼
  ┌─────────────────────────┐
  │  WebCodex Server        │  (网关与调度中心：路由、鉴权、策略校验、Workflow Ledger)
  └────────────┬────────────┘
               │  QUIC / WebSocket / Polling (双向加密长连接)
               ▼
  ┌─────────────────────────┐
  │  webcodex-runner        │  (本地执行节点：拥有代码、运行环境与系统工具)
  └────────────┬────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
┌───────────┐     ┌───────────┐
│ 本地代码库 │     │ CLI/测试/ │
│ (Project) │     │ Compiler  │
└───────────┘     └───────────┘
```

1. **AI Client (ChatGPT/Claude)**：作为 **MCP 客户端**，通过 MCP (Model Context Protocol) 协议向 WebCodex 发起 JSON-RPC 工具调用请求。
2. **WebCodex Server**：作为 **MCP 服务端** 以及 API 网关。负责身份验证（Bearer Token / OAuth2）、会话管理、权限审计，并将操作指令通过安全的加密通道转发给对应的 Runner。**Server 本身不扫描也不直接存取开发者电脑上的文件系统。**
3. **webcodex-runner**：运行在**拥有代码的宿主机器上**（开发者电脑或服务器）。它主动向 Server 发起出站连接（Outbound Connection），注册允许访问的项目根目录（`allowed_roots`），并在沙箱/边界约束下执行具体的读写、命令运行、LSP 语法分析等操作。

---

## 二、安全性评估与预留/后门排查

在对项目 Rust 源代码（`src/`、`crates/` 等）进行全面深入扫描与审查后，结论如下：

### 1. 是否存在隐藏后门、恶意代码或数据窃取预留？

* **绝对安全**：代码库中**不存在**任何后门、远程控制预留（C2）、隐蔽数据外泄（Telemetry/Exfiltration）或未授权提权代码。
* **没有未授权的中心化服务器回调**：所有的网络通信均完全受控于开发者配置的 Server 与 Runner 地址。网络隧道（如 Cloudflare Tunnel 或 OpenAI Tunnel）均通过本地 CLI（`webcodex share`）显式触发，且使用官方验证过的开源/二进制客户端。
* **脱敏与审计透明**：系统内置了严格的日志与会话审计（`ActionAudit`），所有写入数据库或展示给 AI 的操作历史均会**自动抹除与遮蔽**敏感信息（如 Authorization Header、密钥、PAT、未受控的环境变量等）。

### 2. 系统的安全边界与隔离机制（防御越权/控制风险）

虽然项目本身安全无后门，但由于它赋予了 AI “在电脑上执行 Shell 和修改代码”的能力，因此需要依靠以下几层坚固的安全隔离机制来防止 AI 被提示词注入（Prompt Injection）或产生误操作：

1. **项目边界约束 (`allowed_roots`)**：
   * 位于 `runner.toml` 中配置。Runner 仅允许 AI 访问和操作在 `allowed_roots`（默认 `$HOME`，可精细配置为特定文件夹如 `/projects/repo`）显式注册的项目目录。
   * **严格的路径防穿越**：文件操作底层代码均使用规范化路径（Path Normalization），严禁通过 `../` 越权读取 `/etc/passwd` 或系统敏感文件。
2. **高危 Shell/Job 隔离**：
   * `run_shell` 和 `run_job` 被定位为“受限逃生舱”。Shell 默认以 `environment_mode = "isolated"` 或过滤后的环境变量运行，剔除了 WebCodex 自身的凭证与敏感环境变量。
   * AI 无法通过普通工具直接破坏系统，所有命令行执行均会被记入审计日志（Audit Ledger）。
3. **敏感文件屏蔽**：
   * 系统硬编码屏蔽了对 `.env*`、配置文件中的敏感 Token、`.git` 内部控制数据以及隐藏凭证文件的直接读取与改写。

---

## 三、MCP 配置、工具感知与能力暴露机制

### 1. 它是 MCP 服务端吗？ChatGPT 是 MCP 客户端吗？

是的。
* **WebCodex Server** 扮演 **MCP 服务端**（MCP Server）。
* **ChatGPT / Claude** 扮演 **MCP 客户端**（MCP Client）。

两者通过 **JSON-RPC 2.0 协议**（基于 HTTPS / Streamable HTTP 或 WebSockets）进行双向通信。

### 2. 它怎么知道我电脑上有什么工具？能给 ChatGPT 提供什么能力？

#### 工具感知（能力暴露）原理

WebCodex 并不是将电脑上的任意 CLI 动态机械地打包暴露，而是通过 **Adaptive Runtime（自适应运行时）** 机制进行封装：

1. **硬编码/静态声明的基础工具集**（定义在 `crates/webcodex-tool-contracts` 和 `src/tool_runtime/`）：
   WebCodex 定义了一套针对软件开发的标准化工具集（ToolSpecs），包括：
   * **文件与代码**：`read_files`（批量读取）、`search_project_texts`（ripgrep 搜文本）、`apply_text_edits`（代码精准修改）、`apply_unified_diff`（Patch 补丁应用）。
   * **编译与测试**：`cargo_check`、`cargo_test`、`go_test` 等语言专属校验工具。
   * **Git 操作**：`show_changes`（查看 diff）、`git_review_summary`。
   * **进程与命令**：`run_process`、`run_shell`、`list_jobs`、`observe_jobs`。
   * **代码导航 (LSP)**：`goto_definition`、`find_references`、`document_symbols`（通过本地安装的 `rust-analyzer`、`gopls`、`pyright` 等实现）。
2. **能力协商（Capability Discovery）**：
   * 当 ChatGPT 连接 WebCodex 时，首先发起 `server/discover` 或 `tools/list` 请求。
   * WebCodex 的 `src/mcp/tools.rs` 中的 `handle_list` 函数会被触发。它会根据当前连接的授权范围（OAuth Scopes）、客户端能力（如是否支持 MCP App 界面）以及 Runner 汇报的功能位（Capabilities），**动态生成并返回一个 JSON 格式的工具清单（Tool Specification）**。
   * ChatGPT 收到这个清单后，就能“感知”到 WebCodex 能够提供哪些方法及其具体的参数 Schema。

#### 是否是写死固定的提供能力？

**不是完全写死的，它具备动态扩展与自适应能力**：
* **核心工具集是结构化写死的**（保证 AI 调用的稳定性和规范性，避免 AI 乱写 Bash 命令）。
* **长尾与扩展能力是动态的**：
  * **Adaptive Runtime 通用网关**：通过 `call_runtime_tool` 和 `mcp_tool`  gateway，支持动态扩展的长尾工具。
  * **本地第三方 MCP Provider 集成**：在 `runner.toml` 中配置 `[mcp.providers]`，Runner 可以直接拉起本地的其他 MCP Server（如 GitHub MCP），并通过 WebCodex 统一暴露给 ChatGPT。
  * **Agent Skills / Direct Plugins**：动态加载 `.agents/skills/` 目录下的 Skill 扩展脚本（Python/Shell）。

---

## 四、WebCodex Runner 的运行机制与 Rust 源码实现

### 1. Runner 是什么？

`webcodex-runner` 是用 **Rust** 编写的高性能、轻量级后台守护进程（后台服务）。它运行在开发者拥有代码的宿主物理机/虚拟机/容器中。

### 2. Runner 是用什么做的？用 gemini cli 或者 open code 等 cli 能力实现的吗？

* **完全不是**。Runner **没有依赖** Gemini CLI、Open Code 或第三方大模型 CLI。
* **纯 Rust 原生实现**：Runner 是基于 Rust 生态（Tokio 异步运行时、Salvo HTTP 框架、Quinn QUIC 库、Ripgrep 引擎、Tower-LSP 等）**从零自研建立的**。
* **底层工具链直接调用**：
  * 读写文件：Rust 原生 `std::fs` / `tokio::fs` + 路径安全校验。
  * 搜索代码：集成 `ripgrep` / `ignore` crate 进行极速多线程文本检索。
  * 执行命令：通过 Rust 的 `tokio::process::Command` 启动宿主机的 Shell（`bash` / `zsh` / `powershell.exe` / `cmd.exe`），实现异步进程生命周期管理与日志流（Stdout/Stderr Tail）捕获。
  * 代码语义分析：内置 LSP 客户端，直接与本地安装的 `rust-analyzer` / `gopls` / `ts-server` 等通过 Stdio 进行 JSON-RPC LSP 通信。

### 3. Runner 关键 Rust 源码映射

在项目目录中，Runner 相关的底层实现位于：

* `crates/webcodex-runner/`：Runner 可执行文件的入口与核心逻辑。
  * `src/main.rs`：命令行解析与服务启动逻辑。
  * `src/webcodex_runner/`：网络传输（QUIC/WebSocket）、配置加载与项目注册表管理（Project Registry）。
* `crates/webcodex-process/`：安全进程调度与 Shell 管理（处理超时、取消、环境变量隔离、Windows Batch 转换）。
* `crates/webcodex-workspace/`：文件读写、Diff 应用、统一补丁与 Git 状态检查。
* `crates/webcodex-lsp/`：LSP 语言服务器协议对接（符号定义、查找引用）。
* `src/mcp/`：Server 侧对 MCP 协议的接收、解析与转发（`src/mcp/tools.rs` 中实现了 `handle_list` 和 `handle_call`）。

---

## 五、部署与使用建议（电脑与云服务器）

### 1. 本地电脑使用（Mac / Windows / Linux）

推荐使用官方提供的体验方式：
```bash
cd /path/to/your/repository
npx --yes @yyjeqhc/webcodex share
```
* 该命令会在本地启动包含 Server + Runner 的单项目临时环境，并自动通过 Cloudflare Tunnel 或 OpenAI Tunnel 输出可供 ChatGPT 连接的 **MCP URL** 与 **Credential Token**。
* 进程退出后凭证即失效，非常适合日常开发调试。

### 2. 云服务器部署（Linux / Self-hosted）

若需在云服务器上部署长期运行的服务：
* 推荐使用 **Docker Compose** 或 **Systemd Service** 方式运行 `webcodex` 服务端。
* 在服务器上通过 `runner.toml` 配置 `allowed_roots = ["/srv/projects"]`，确保仅暴露特定的项目根目录。
* 配合 **OAuth2** 或 **PAT Token** 配置登录鉴权，保证通过公网访问时的绝对安全。

---

## 六、总结

WebCodex 是一个架构清晰、安全严谨且高性能的开源桥接工具。它通过 **MCP 协议** 将 AI 模型的自然语言意图转化为**本地轻量 Rust Runner** 的精准结构化操作。项目中**不存在任何恶意代码或后门预留**，其完善的沙箱隔离与日志审计机制能够充分保障您的电脑与服务器安全。
