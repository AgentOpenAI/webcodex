# 项目图片预览与本机部署

`present_image` 为显式选择的已授权 PNG、JPEG、WebP 打开一个 MCP App。
参数 `path`（既有单图接口）与 `paths`（同一项目内按请求顺序的 1～16 张图）恰选其一；
4 MiB 以内优先显示原图；较大原图（最多 64 MiB、67,108,864 输入像素）自动生成 WebP 压缩预览。
预览最多 2 MiB、最长边 2048，应用 EXIF 方向并保留透明通道，动画预览标明静态首帧。
整批按最终展示字节限制为 32 MiB；超过时优先压缩较大的原图，保留全部请求位置。
它不需要 Git 变更或 Workflow Session。
`inspect_project_artifact(action=image)` 用于模型观察，不能作为用户已经看到图片的证据。

卡片使用现有 App-only `read_app_artifact_chunk` 读取每段最多 512 KiB 的私有数据，
固定项目、路径、大小、SHA-256，并在显示前核对完整摘要和图片签名。
源文件变化、错误分块、解码失败均显示错误；重试保留原来的文件版本。
支持适应宽度和原始尺寸显示，原图保持不变。
图片不上传到图床，不向模型输出完整 Base64，也不开放新的公网入口。

多图先收集所有实际保存路径，再一次调用 `present_image(project, paths)`。
同一个 UI 保留每个请求项，分别显示图片或错误并独立重试；不能依赖重复调用
单图工具来保证宿主保留多个可见卡片。非法路径、参数歧义和重复规范路径在读取前拒绝；
缺失或不支持的单个文件保留明确错误位置，不会丢弃其他请求项；全部失败仍是业务失败。
界面明确区分压缩预览和原图。预览缓存不写入用户项目，原图不修改。
缓存最多 32 项/64 MiB、30 分钟；每次使用均重新校验源文件权限与大小/SHA，淘汰或重启后按同一源版本重建，编码结果不同则要求重新打开。
单图变化/删除不能悄悄改成另一张图。UI 最多并发读取两张，保留的解码像素总量最多 67,108,864。

新调用使用 `ui://webcodex/image/v5`。ChatGPT 历史卡片请求 v1、v2、v3 或 v4 时，
服务端返回同一套当前只读展示界面，既有单图和多图结果格式仍可读取。
服务端更新无法清除客户端已经缓存的旧卡片；刷新宿主工具列表并重新展示图片后使用 v5。
服务器不会从之前的请求或 ClientWindow 自动推断、收集历史图片。

聊天附件使用 `import_host_files`。既有回环 OpenAI Tunnel 部署需要显式设置
`WEBCODEX_MCP_TRUST_LOOPBACK_API_TOKEN_FILE_IMPORT=true`，并保持原来的路径、权限、
HTTPS、下载大小及来源检查。该选项不是允许任意来源；有效宿主附件不再因 bootstrap
认证方式被拒绝。现有登录浏览器通过 Runner 的 `[mcp]` provider 接入
`managed-browser-mcp`，继续使用自己的 profile 和锁，不复制登录数据。
本机 provider 通过 `scripts/managed_browser_gateway.cjs` 适配原管理器：指定文件名的
截图也返回标准 MCP 图片，并给出 `screenshot_project_path`。工作目录先维持现状，
默认保存到 `artifacts/managed-browser`，每张截图独立保留。文件名包含北京时间
`YYYY-MM-DD_HH-mm-ss-SSS`（年月日时分秒及毫秒）和随机 UUID；独占创建文件，
即使名称碰撞也不会覆盖原图，只重新分配文件名，不重试页面操作。
`filename` 是命名提示，保留其目录、主文件名和图片扩展名，再追加唯一后缀；
必须以实际返回的 `screenshot_project_path` 为准。历史卡片依赖的原图需要保留，
删除源文件后仍无法重新加载对应卡片。运行截图已加入 Git 忽略，不能作为测试垃圾清理。
较大截图仍返回实际项目路径，通过 `present_image` 自动压缩显示；原生 MCP 图片负载本身的 4 MiB 限制保留。
用户查看时用返回的路径调用
`present_image`。适配器串行执行、不重试页面操作，断开时正常保存并关闭自己绑定的 profile。

## 此服务器的受控部署

`scripts/deploy_local_runtime.py` 仅针对已存在的独立 systemd 安装：
`/usr/local/lib/webcodex`、`/etc/webcodex/webcodex.env`、`/var/lib/webcodex`，
以及 `ubuntu` 的既有 Runner。它不创建或迁移 Core Environment，也不发布安装包。

先在干净的已提交源码上编译三个程序，再运行：

```bash
cargo build --locked --profile dogfood -j 2 \
  -p webcodex -p webcodex-cli -p webcodex-runner --bins
sudo python3 scripts/deploy_local_runtime.py preflight \
  --candidate-dir "$PWD/target/dogfood" --expected-commit "$(git rev-parse HEAD)" \
  --bridge-dir /tmp/webcodex-v046-bridge
```

旧版低于 0.4.6 时，必须提供经官方校验值验证的 ARM64 0.4.6 二进制过渡版本。
预检用 SQLite backup API 获取一致的副本，依次启动 0.4.6 和候选 Server，检查数据库，
不停止当前服务。`apply` 重做预检，确认无活动任务后停止 Tunnel、Runner、Server 和
socket，备份当前安装，再对实际数据执行相同过渡并切换程序。

```bash
sudo python3 scripts/deploy_local_runtime.py apply \
  --candidate-dir "$PWD/target/dogfood" --expected-commit "$(git rev-parse HEAD)" \
  --bridge-dir /tmp/webcodex-v046-bridge
```

唯一保留的回滚点是 `/var/backups/webcodex/previous`，含旧程序、服务数据、Server
环境和 Runner 配置/登记。新快照完整写好后才删除上一次回滚点；临时
`previous.next` 表示未完成的备份事务，必须核对后处理，不能盲目重跑。
迁移或切换失败时自动恢复本次替换前的程序、配置和数据。服务定义、开机启动和用户
linger 保留；不另外创建保活程序。完成后还须验收真实 MCP、图片卡片、附件和浏览器。

```bash
sudo python3 scripts/deploy_local_runtime.py rollback \
  --candidate-dir "$PWD/target/dogfood" --expected-commit "$(git rev-parse HEAD)"
```

回滚会恢复上一版数据快照，覆盖部署后产生的服务数据，因此只能在明确需要回滚时运行。
正常升级后须在 ChatGPT 刷新工具列表，重新打开图片卡片。旧工具名称不保留别名。

## 验证

```bash
cargo test --locked --profile dogfood -p webcodex --lib image_document
python3 -m unittest scripts/tests/test_deploy_local_runtime.py
node --test scripts/tests/managed_browser_screenshot.test.cjs
WEBCODEX_PLAYWRIGHT_PACKAGE=/path/to/browser-tools/package.json \
  node scripts/ui-smoke/image-card.mjs /path/to/logo.png
```

浏览器验收覆盖手机/桌面显示、损坏内容、版本变化和重试。
截图回归覆盖同毫秒/显式同名保存、强制名称碰撞、路径边界，以及大图仍返回实际路径；
浏览器 smoke 连续传入同一文件名两次，并核对第一张原图未被修改。
多图还须验收 1、2、16 个请求位置、顺序与逐图可见、数量/总大小超限、部分失败，以及
新结果替换尚在加载的旧图集。宿主协议夹具不能替代 ChatGPT 实际页面及真实附件的最终验收。

`main-my` 本机更新还须执行 [AGENTS.md 的安全及清理约束](../../AGENTS.md#6-main-my-本机维护约束)：
构建前完成安全检查，未处理的未授权访问、控制或外传风险会阻断构建部署；验收成功后
清理本次归属明确的临时产物，保留依赖/增量缓存、用户数据和唯一上一版回滚点。

## Sharp 自动预览配置

本机部署复用现有 Node 和 `/home/ubuntu/tools/image-tools` 的 Sharp，不安装新工具。
配置 `WEBCODEX_IMAGE_PREVIEW_NODE`（绝对 Node 路径）及
`WEBCODEX_IMAGE_PREVIEW_SHARP_PACKAGE`（Sharp 所属 package.json 绝对路径）。
独立部署脚本核对已有文件后设置这两项；还原上一版时恢复原配置。
固定处理脚本嵌入程序，只接收授权原始字节，不接受模型传入文件路径或 URL。
清空继承环境、单任务处理、并发排空有界输出，处理进程树硬超时 30 秒，准备总超时 90 秒；取消请求结束自己拥有的处理树。
图库读取共享两路分块上限。
超过源文件/像素/处理时间的安全预算或文件损坏会保留明确错误，不作无限解码。

```bash
node --test scripts/tests/image_preview.test.cjs
node scripts/ui-smoke/image-gallery.mjs
```

较小但高像素的原图还会在 UI 中按每图像素份额适配为明确标注的静态预览；源文件保持不变。PNG/JPEG/WebP 声明尺寸在浏览器解码前检查，单图仍受 67,108,864 像素限制；同一图库总保留像素限制不放宽。不可取消的 canvas 编码保留并发槽直到回调结束，迟到结果不能覆盖新图库。


## ChatGPT 授权与 WebCodex 执行权限

ChatGPT 的应用操作审批独立于服务器身份认证和 WebCodex 的 `authority.mode`。
本机 `trusted_agent` 不要求服务器人工审批，不意味着 ChatGPT 必须免确认；新会话也不会改变这个区分。
图片工具按真实只读语义标注，命令、脚本和通用调度器仍保留相应效果提示，不能伪装只读来压制宿主审批。
可在 ChatGPT 设置中的 Apps/Plugins → 对应 WebCodex 应用/连接账号 → Permissions 中查看可保存的权限选项。
是否提供允许所有操作、是否跨会话保留以及额外安全审核由账号、工作区和宿主策略决定，服务器不能代为保证。
排查重复卡片应先收集卡片原文、工具名与连接账号，不直接放宽认证或修改执行权限。
