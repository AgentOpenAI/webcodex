# Project Knowledge 原生工具插件

[English](README.md) | [简体中文](README.zh-CN.md)

这是 WebCodex 可选的本地源码检索插件，只索引 provider 配置的 Git 工作树根目录中，
已被 Git 跟踪的 Markdown、UTF-8 文本以及常见代码/配置格式。SQLite FTS5 使用 BM25
排序标识符词项和中文 CJK 二元组。无需 embedding、模型 API、网络服务、Python
第三方包或构建步骤。

插件通过已有的 [`plugin_tool` 网关](../../docs/PLUGINS.zh-CN.md) 使用
`webcodex-plugin-v1` 原生协议。它不新增核心工具、Memory 存储、指导文件或后台索引。
移除或禁用该 provider 不影响其他 WebCodex 功能。仓库文本是不可信的来源数据；
检索结果不会授权执行文本中的指令，也不会授权写入 Memory 或指导文件。

## 环境与测试

需要 Python **3.10 或更高版本**、Git，以及启用 **FTS5** 的 Python SQLite。
`initialize` 会实际创建 FTS5 表、插入词项并查询，而不是只查看编译选项。能力探测
失败时，插件准入失败并返回安全的 FTS5 提示，不会静默切换搜索引擎。

宿主必须支持相对于目录描述符的 `os.open` 与 `O_NOFOLLOW`（例如 Linux）。
不支持时初始化失败，不会降低符号链接防护。测试不需要 Server、Runner、凭据或网络：

```bash
python3 -B -m unittest discover -s plugins/project-knowledge -v
```

测试包含真实子进程的初始化、工具发现、索引/检索/读取和 EOF 前交互式刷新，还覆盖
FTS5 缺失、过期/删除来源、目录与根替换、敏感/二进制内容、结果边界和失败重建后旧索引
保留。它们不宣称验证了在线 Runner 准入或 `plugin_tool` 权限与 binding。
回归还覆盖达到文件上限的长标点来源、损坏的缓存 metadata 和非法缓存行号。
metadata 或行号非法时返回已知重建错误，不会终止 provider，也不会声称错误的来源范围。

构建 dogfood Server/Runner 后，运行独立的真实 MCP → Server → WebSocket Runner →
原生 provider smoke：

```bash
python3 -B scripts/e2e_project_knowledge_ws.py --bin-dir /absolute/path/to/target/dogfood
```

脚本复用一次性服务 fixture，创建临时用户/凭据、Project、Runner 配置与缓存，验证真实准入、
Project binding、index/search/read、缺少 invoke scope、跨 Project/根参数拒绝、过期来源排除
以及移除 provider。它不启动模型服务、不接触共享服务或配置，结束后清理所有临时资源。

## 配置指定 Runner

手动将可选 provider 加入目标 Runner 的 `runner.toml`：

```toml
[[plugins.providers]]
id = "project-knowledge"
name = "Project Knowledge"
command = "/absolute/path/to/python3"
args = ["-B", "/absolute/path/to/webcodex/plugins/project-knowledge/plugin.py"]
cwd = "/absolute/path/to/git-project"
timeout_secs = 30
```

`cwd` 必须正好是普通 Git 工作树根目录，linked worktree 也适用。子目录、符号链接路径、
文件系统根目录以及用户主目录会被拒绝。插件记录根目录的文件系统身份并拒绝替换。
工具参数不能选择根目录、命令、缓存或环境；继承的 `GIT_*` 环境覆盖也不能把 Git
观察重定向到另一个仓库。

缓存位于 `$XDG_CACHE_HOME/webcodex-project-knowledge/<root-hash>/index.sqlite3`，
未设置 `XDG_CACHE_HOME` 时位于
`~/.cache/webcodex-project-knowledge/<root-hash>/index.sqlite3`。如有需要，由操作者在
Runner 准备的环境中设置 `XDG_CACHE_HOME`，调用者不能修改。缓存目录必须属于当前用户、
不可被其他用户访问（POSIX 上为 `0700`）、位于 Project 外且不经过符号链接。
数据库与构建文件权限为 `0600`。即使被 Git 忽略，Project 内的缓存也会被拒绝。
缓存路径不会返回给模型。可以在本地删除派生 SQLite 文件来丢弃索引；移除 provider
不会自动删除其私有缓存。

使用已有授权凭据执行正常 author loop：

```text
webcodex plugin check --runner <runner> --plugin project-knowledge
webcodex plugin reload --runner <runner>
webcodex plugin list --runner <runner> --plugin project-knowledge
```

在 check 返回 `ready=true` 后继续。check 启动并销毁候选实例；reload 替换**完整配置的
provider 集合**，旧 binding 随之失效。list/describe 需要 `plugin:inspect`，check/reload
需要 `plugin:manage`，调用需要 `plugin:invoke`。四个工具均声明 `projectBound=true`：
describe 还需要 `project:read`，已有网关策略要求调用具备 `project:write`，包括缓存/来源观察。
本插件不创建凭据/注册信息，也不改
Runner 配置。

## 工具与来源信息

对需要的工具执行 describe，并显式提供与 provider cwd 匹配的已授权 Project，然后通过 `plugin_tool(action="call", binding=...,
arguments=...)` 调用返回的不透明 binding。没有 `webcodex plugin call` 命令，也不向
外层 MCP 工具列表加入 provider 工具。

```json
{"action":"describe","runner":"<runner>","plugin":"project-knowledge","tool":"index","project":"agent:<runner>:<project-id>"}
{"action":"call","binding":"<binding from describe>","arguments":{}}
```

当前 `webcodex plugin describe` CLI 没有 Project 参数，应使用上述 canonical `plugin_tool`
describe 请求。Runner 在向 provider 发送调用字节前，拒绝绑定到其他 Project 根的调用。
Project binding 是路由与授权边界，不是任意原生可执行程序的沙箱。

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `index` | `{}` | 显式重建派生缓存；只有该工具写缓存数据。 |
| `status` | `{}` | 读取已保存的覆盖信息，或返回 `indexed=false`；不扫描/重建。 |
| `search` | `{"query":"parseHTTPRequest 项目知识","limit":5}` | 对已有索引排序，并核验当前跟踪状态和来源哈希后返回片段。 |
| `read` | `{"path":"src/model.py","source_hash":"<search 返回的哈希>","start_line":1,"end_line":12}` | 重新核验资格和预期哈希，返回当前来源行或已知错误。 |

命中项包含 `path`、`start_line`、`end_line`、`text`、`source_hash`、`index_revision`
和 `observed_revision`。行号从 1 开始且包含两端，哈希是完整当前文件字节的 SHA-256。
revision 是本地 HEAD 观察（首次提交前为 `null`），**不能证明文件等同于已提交版本**；已跟踪的工作树修改也能
被索引。返回片段来自重新读取的当前字节，不来自缓存文本。核验只代表调用时观察，
不保证后续不变；因此 read 必须提供预期哈希。哈希变化后应重新 index 和 search。

已改变、已删除、不再跟踪或新被排除的候选会被省略；`stale_candidates_omitted` 统计
已检查候选中的省略数。每次最多检查 80 个排序候选，过期候选可能遮蔽后续命中。
`results_truncated` 标记候选、结果数、时间或字节限制。零命中不证明内容不存在。
检索不会自动重建缓存。

coverage 仅描述**一次索引运行**，不宣称整个语料当前最新：`revision`、
`indexed_at_unix`、`eligible_files`、`indexed_files`、`indexed_bytes`、`chunks`、
`excluded_entries`、`skipped_files`、`oversized_lines_omitted`、`unprocessed_files`
和 `stop_reason`。excluded 包括不支持的格式、敏感路径、符号链接、子模块、非法路径
以及冲突索引项；skipped 包括不可读、硬链接、二进制、敏感内容或超大文件。
被 Git 跟踪不等于内容安全或索引完整。

## 边界与隐私

- 每轮最多 **4,096 个索引文件**、**每文件 256 KiB**、**64 MiB 来源字节**，索引工作
  预算为 **20 秒**。在有界读取、片段和 SQLite 步骤之间检查时间；最终提交、fsync 和
  原子替换可能增加本地文件系统耗时。Git 子进程使用剩余时间，最多捕获 **8 MiB**
  输出；超限失败不会替换旧索引。
- search 默认 **5 项**，允许 **1–20 项**，本地工作预算 **5 秒**。序列化工具结果不超过
  **16 KiB**。read 默认 48 行，最多 200 行，并按完整行缩减到相同字节边界。
  超过 4 KiB 的单行不参与索引并计入 coverage；单行超过 read 结果边界时显式失败。
- 只允许格式白名单内 stage-zero 的普通已跟踪文件。隐藏路径（包括 `.env`、`.git`）、
  路径穿越、控制字符、敏感路径名、来源任一组件中的符号链接、硬链接、二进制内容及
  可识别的密钥/令牌/密码模式均被排除。这些保守启发式可能排除正常文本，且**无法识别
  所有秘密**。为调用者启用源码检索前应检查仓库跟踪内容。
- 重建在私有、可丢弃的 SQLite 文件中进行，并通过原子替换发布。**达到 20 秒工作预算时
  会发布只包含已完整处理且已提交来源的部分索引**（`stop_reason=time_limit`），而非
  随机丢弃首次构建成果。首次完成文件、之后至多每 512 个完成文件，以及临近截止时均
  设有检查点。SQLite 进度中断可能回滚当前尚未提交的整批文件；这些文件计入
  `unprocessed_files`，不会被错误标记为可检索。Git、SQLite、缓存及其他**非预算失败**
  会丢弃临时构建并保留上次已发布索引。应检查 coverage：`indexed=true` **不代表**
  完整或最新覆盖。重建是重新进行有界扫描，而不是从旧断点增量续建。不会自动写入
  Project、Git、Memory 或指导文件，也不会调用外部模型、监听或修改配置。

Runner 仍负责 schema 准入、权限、精确 provider binding、进程生命周期、超时、结果
验证和传输结果不确定性。不确定的 index 调用之后先观察 status，再决定是否重建；
插件不会替调用者自动重试。
