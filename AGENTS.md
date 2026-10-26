# AGENTS.md — WebCodex Repository Rules

Use the host's tools for local WebCodex work and [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup/validation. Deeper `AGENTS.md` files govern their directories. Load domain guidance at the relevant boundary; `webcodex.workflow` applies to connected-runtime callers.

WebCodex is actively developed. Features, fixes, and reliability work are welcome, but preserve credential, process-tree, transport, durability, authority, replay-safety, and boundedness contracts.

## 1. Product and authority invariants

- Protect real authority boundaries: credentials, public entry points, destructive actions, execution targets, process ownership, history, and published artifacts. Model new credential audiences, scopes, identities, leases, and replaceable targets explicitly; stale requests must not retarget or gain authority.
- Never print, commit, or expose credentials, authorization headers, private keys, tokens, secret files, or sensitive command output.
- Structured execution lifecycle state owns retry safety. Semantic ambiguity, authority changes, stale fences, replay uncertainty, and uncertain effects fail closed; presentation or model ergonomics never override execution authority.
- Keep one canonical machine representation per fact or follow-up. Static/internal taxonomies and forensic bookkeeping belong in runtime types, tests, telemetry, or exceptional diagnostics rather than duplicate model-facing fields. Model-facing compatibility requires a named concrete consumer; historical aliases are not retained merely because an older implementation emitted them.
- HTTP/MCP requests are stateless unless the exact adapter contract supplies a stable `ClientWindow`. Never infer Workflow Session, model-context retention, or authority from transport/audit IDs, credentials, Projects, or prior requests.
- Keep Connector Tasks, Workflow Sessions, durable Agents/Conversations/Wakes, and Agent Tasks distinct. Persistence of identity or history is not permission to replay an effect.
- Keep core execution and Job semantics protocol-, UI-, transport-, and OS-neutral. Host-specific behavior, including MCP App orchestration, belongs in explicit adapters.
- Boundedness is a correctness property for model surfaces, logs, persistence, scans, queues, and retained state. Do not turn ergonomic limits into authority bypasses or silently widen resource contracts.

Product direction: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 2. WebCodex implementation conventions

- Before nontrivial edits, locate the owning layer, trace relevant callers/data flow, and find reusable code. Read applicable design guidance; scale exploration to the task. Follow authoritative paths and naming, completing cross-layer enums, registries, schemas, adapters, persistence/recovery and projections end to end.
- Share typed facts, request contracts and lifecycle logic where semantics agree; keep transport authorization and presentation in adapters. Do not reparse model-facing JSON for internal queries or couple distinct domains merely for similar syntax.
- Minimize concepts and maintenance points in a coherent root-cause fix. Include necessary local refactoring and superseded-path cleanup; keep unrelated redesign separate.
- Existing implementation, comments, tests and compatibility code are evidence, not permanent requirements. Retire obsolete adapters/configuration/tests together when their concrete consumer is gone; preserve wire, authority, durability and release boundaries.
- Retain supported published installation/data formats and named external protocol consumers; unreleased main history alone does not justify compatibility. Check the actual stable tag before pruning, and separate migration-only code from current installer/recovery duties. See [`docs/compatibility-policy.md`](docs/compatibility-policy.md).
- Model-facing directness is exposure/ergonomics, not authority. Generic dispatch may serve an admitted tool only through the same canonical schema, authorization, permission, capability, and effect checks; hidden or unadmitted tools remain unavailable.
- ToolSpec descriptions must be self-contained about selection, authority, effects, retries, continuation, uncertainty, and recovery. Use the available description budget when semantics require it; arbitrary brevity must not erase safety or recovery meaning.
- Prefer one unambiguous model-visible next action. If removing a result field leaves the same business interpretation and exact next action, omit the duplicate by default. See [`docs/agent/tool-contract-guidelines.md`](docs/agent/tool-contract-guidelines.md).
- Prefer host-native artifact import/export or project transfer for binary files. Do not route complete binary payloads through model-generated Base64 merely to cross a tool boundary.
- New execution/provider integrations must preserve process-tree ownership, credential isolation, cancellation, timeout, durable Job identity, and recovery semantics rather than bypassing ToolRuntime contracts.
- Before filing a GitHub issue, follow **Reporting issues** in [`CONTRIBUTING.md`](CONTRIBUTING.md): distinguish directly reproduced facts from source-based inference or user reports, include discoverable evidence, and never invent missing environment details or a root cause.

## 3. Rust, tests, and validation

- Use the `dogfood` Cargo profile for optimized development builds. Reserve `release` for formal release/publication artifacts.
- Documentation-only changes use `python3 scripts/check_markdown_links.py` and diff review, not Cargo builds. Keep existing English/Chinese peers aligned under [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md).
- Rust changes normally use the smallest package/focused tests that detect the changed behavior. Full workspace/library runs, `--all-targets`, ignored tests, real-process harnesses, and E2E are for explicit need, release/deployment, cross-cutting boundaries, broad conflict resolution, or a focused-coverage gap.
- Treat `cargo fmt` as finalization after Rust source stabilizes, not a mutation-by-mutation loop. CI/release formatting remains a final-state gate.
- Put tests in the existing domain test tree. Keep inline private-helper tests small; process/network/integration fixtures belong in dedicated modules.
- Process fixtures must mirror production I/O ownership: absent stdin is EOF; explicit stdin is those bytes then EOF; drain/capture stdout and stderr without pipe deadlocks; never accidentally inherit the invoking terminal. Prefer child-local configuration/environment over process-global mutation.
- For console-only or flaky failures, reproduce with one controlled boundary changed and add a deterministic regression that also fails headlessly. Retries, larger timeouts, and lower concurrency are diagnostic/resource controls, not substitutes for the demonstrated fix.
- Distinguish current failures, pre-existing failures, expected negative cases, and failures resolved by retry. Never weaken authentication, authorization, validation, schemas, sandboxing, ownership checks, or tests merely to make validation green.
- Public or persisted contract changes need focused compatibility/privacy/boundedness coverage. Recovery tests should prove identity/effect semantics, not only happy-path output.
- Review behavior and structure: cite code and impact for duplication, misplaced responsibilities or incomplete migrations introduced or worsened by the change. Separate required fixes from optional cleanup; passing tests do not prove architectural fit, and style alone is not a finding. Review-only work does not authorize edits.

Testing guidance: [`docs/TESTING.md`](docs/TESTING.md).

## 4. Git, deployment, and release authority

- Push, publish, tag, release, deploy, restart services, or otherwise mutate external systems only when the user explicitly authorizes that action and target.
- Honor existing explicit authorization for the same action and target; do not ask again at each step. Runtime authority mode does not itself authorize repository publication or deployment.
- Do not force-push, move published tags, overwrite releases, or rewrite published history without explicit authorization naming that operation and target. Failed pre-publication tag recovery is allowed only through the documented guarded reclaim path.
- A named development/dogfood deployment is not a release. Deploy the reviewed source commit, preserve rollback, record build identity without hiding dirty state, and run focused smoke; this does not authorize version bumps, tags, or publication.
- Release/publication must obey immutable artifact and signing/provenance contracts. Follow [`docs/agent/release-process.md`](docs/agent/release-process.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

## 5. Domain sources of truth

Route detailed decisions to the owning document instead of restating those contracts here:

- Public runtime/API surfaces: [`docs/agent/runtime-api-guidelines.md`](docs/agent/runtime-api-guidelines.md)
- Model-facing tool contracts and friction policy: [`docs/agent/tool-contract-guidelines.md`](docs/agent/tool-contract-guidelines.md)
- Workflow Sessions and request identity: [`docs/agent/session-model.md`](docs/agent/session-model.md)
- Manual multi-window collaboration: [`docs/agent/manual-window-collaboration.md`](docs/agent/manual-window-collaboration.md)
- Durable Agent identity, Conversation, Wake, and asynchronous Agent work: [`docs/architecture/durable-agent-runtime.md`](docs/architecture/durable-agent-runtime.md)
- Current durable Agent/Conversation/Wake implementation contract: [`docs/architecture/durable-agent-conversation.md`](docs/architecture/durable-agent-conversation.md)
- Authority boundaries: [`docs/agent/permission-model.md`](docs/agent/permission-model.md)
- Architecture decisions: [`docs/agent/architecture-decisions.md`](docs/agent/architecture-decisions.md)
- Release/recovery/deployment: [`docs/agent/release-process.md`](docs/agent/release-process.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)

## 6. main-my 本机维护约束

以下两项适用于 `main-my` 在本服务器的更新、构建及部署；用户本次明确要求的范围优先。

1. **先过安全检查，再允许构建。** 更新/合并并解决冲突后，审核实际变更、依赖和构建脚本，以及本机生效的认证、授权、账号归属、监听/代理/Tunnel、Runner、浏览器管理器和凭据权限。重点排查提交中的秘密、隐藏账号或凭据、认证绕过、未授权远程控制、异常外传及其他安全风险。只允许用户本人及其明确授权的身份使用；匿名入口、任意未签发密钥回退等合法兼容模式，也不能绕过这一要求。发现未经授权身份可连接/使用、后门、控制或外传风险时，立即停止构建和部署，向用户说明证据、影响及不确定性，待用户明确处理方式；不得自行放宽鉴权或以测试通过代替安全审核。涉及安全边界或可执行部署改动时安排独立 agent 复核；不可用时明确说明审核局限。不得把有限审查表述为已穷尽证明不存在漏洞。
2. **验收成功后清理本次任务的临时产物。** 安全检查通过后，才构建、受控部署并验证实际功能和原有保活。验收需覆盖用户操作结果及文件生命周期，包括实际工作目录、重复截图不覆盖、旧图仍可读取，以及删除源文件后的行为；不能只验证工具调用成功。开始操作时记录本次临时路径、进程和服务的归属；确认部署成功且正常使用后，删除本次构建/审核/测试生成的隔离数据、临时工作树、临时脚本、截图、日志、报告和 `/tmp` 等位置的临时文件，并结束临时进程/服务。保留构建依赖与增量缓存、在用程序、正式源码及回归测试、用户实际文件/截图和必需配置；不能把被聊天历史引用的正式截图当作垃圾。备份和回滚仅保留一个完整的上一版，新备份完整后才删除更早一份。清理必须核对具体路径和所有权，不得清空整个 `/tmp`、删除他人或其他任务的数据；未部署成功时保留必要恢复现场并说明。必要审核结论记入提交或交付说明，不遗留敏感测试数据。

本地先形成干净提交以固定构建身份；安全、构建、部署和全部功能验收通过后才能推送远端，不得将最后一项验收与推送并行。提交标题和正文描述实际代码行为及已核验事实，不写“等待用户批准”“尚未部署”等会过期的临时进度。多图验收必须核对同一次交付的完整数量、顺序、逐图可见、部分失败和数量/大小边界；不得将多次单图工具调用成功当作多张图完整可见。压缩或改写已发布历史须有用户明确授权并限定分支，更新远端使用精确旧 SHA 的 `--force-with-lease`，不得改写上游或其他分支。

宿主审批与服务器授权分层排查，不得通过虚假只读提示或放宽鉴权减少确认。
