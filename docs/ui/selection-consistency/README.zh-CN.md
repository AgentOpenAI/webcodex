# 统一选中态与控件

[English](README.md)

本次实现 [#1211](https://github.com/yyjeqhc/webcodex/issues/1211)。
已完成的 [#1172](https://github.com/yyjeqhc/webcodex/issues/1172)、
[#1174](https://github.com/yyjeqhc/webcodex/issues/1174)、
[#1186](https://github.com/yyjeqhc/webcodex/issues/1186) 和
[#1198](https://github.com/yyjeqhc/webcodex/issues/1198) 是历史 UI 工作；本次是新增的跨端选中态、控件和布局统一。

默认使用淡主题色背景、可读的主题色文字和图标表示选中项，Web 外观菜单、Desktop 通用设置和卡片外观设置均可选择主题色或黑白。黑白模式随明暗主题反转，并保留已保存的主题色。Runtime/Admin 同源共享本地偏好；Desktop 和 MCP 的 iframe 来源/宿主存储分区分别保存。存储被禁用时，当前页面仍可使用内存中的选择。不增加服务端偏好接口或权限状态。

导航和紧凑互斥选择使用圆角填充滑块；设置/扩展的纵向分类及其响应式网格均属于导航。只有横向内容页签使用与文字、图标等宽的 3px 圆角下划线。仅仅横向排列不代表内容页签，例如 Home/Goals 仍按主导航处理。共享控制器沿用 260ms、最多 3% 拉伸，文字和图标保持静止；快速反向切换从当前可见位置继续。卡片绘制前的排版变化会修正目标并继续动画；响应式变化会重新校准定位容器。减少动态效果模式取消移动，高对比度使用平台选中态和焦点。状态、危险操作和普通操作保留语义颜色。

React 普通下拉框统一使用 Mantine Select。原生 HTML 卡片使用共享的 portal 列表框，原 select 继续拥有表单、值及变更事件。覆盖方向键、Enter、Escape、焦点返回、禁用选项、滚动和窄屏定位。输入控件使用圆角边框与焦点，消息输入区的焦点环沿外层圆角显示。

## 四处截图对应修复

1. 目标/活动放入紧凑、横跨工作区的顶栏，左右面板从同一行开始；窗口/协作改为下划线。

   ![Runtime 淡蓝导航与横向内容下划线](runtime-activity-light.png)

   ![Runtime 深色对齐布局](runtime-activity-dark.png)

2. 协作下拉框使用主题弹层，消息输入区显示完整圆角焦点环。

   ![协作下拉框](runtime-composer-dropdown.png)

3. Admin 主内容占满侧栏后的可用宽度，间距统一；保留侧栏吸顶，主标题随页面滚动，摘要卡片不会重叠。锚点选中态兼容小数像素取整。

   ![Admin 顶部](admin-top.png)

   ![Admin 导航滚动后](admin-scrolled.png)

4. MCP Home/Goals 接入真实共享填充动画，Work Result 内容和电子表格工作表导航使用下划线。通过第一方生成流程更新独立 HTML 资源，版本递增为 Workbench v8、Work Result v33、spreadsheet v4。

   ![MCP Home/Goals](workbench-home-goals.png)

   ![Work Result 窄屏下拉框](work-result-dropdown.png)

## 配色、窄屏与动画

![Runtime 深色黑白模式](runtime-monochrome.png)

![Runtime 移动布局](runtime-mobile.png)

![Admin 移动布局黑白模式锚点](admin-mobile.png)

![MCP 320px 本地黑白设置](workbench-mobile-monochrome.png)

![Runtime 动画中间帧](runtime-mid-motion.png)

录屏包含真实浏览器交互，以及断言使用的暂停中间帧：
[Runtime 动画](runtime-motion.webm)、[MCP Workbench 动画](workbench-motion.webm)。

## Linux 原生验证

在已解锁的 Linux 图形会话运行原生 dogfood 构建，使用真实 WebKitGTK 渲染器和 Tauri 后端。使用一次性本地 Server/Runner、合成用户/项目、独立配置/数据目录和私有 D-Bus 隔离 viewer；在本地核实可执行文件、构建身份、监听器归属及临时 Runner 身份。不安装 Tunnel 或服务。验证后清理了全部自有进程、临时凭据和状态。

实际原生输入打开设置和下拉框，通过方向键/Enter 选择黑白，再切换深色；Escape 取消其他高亮选项，并将窗口从 1180px 缩至 800px。以下均为原生窗口截图：

![原生 Desktop 淡蓝分类导航](desktop-native-navigation.png)

![原生 Desktop 配色弹层](desktop-native-appearance.png)

![原生 Desktop 深色黑白](desktop-native-dark-monochrome.png)

![原生 Desktop 800px](desktop-native-narrow.png)

## 移动端内容边界与窗口详情

后续缺陷 [#1215](https://github.com/yyjeqhc/webcodex/issues/1215) 在同一个尚未合并的 UI PR 中修正。窄屏顶部栏、主滚动区与底部导航分别占据独立的视口行；底栏与顶部栏同色，并用细分隔线区分内容，经典细滚动条占位时左右间距仍一致。底部安全区内边距参与布局，不会覆盖内容。折叠的窗口详情入口不再展示难读的短 ID；展开后保留完整 Window ID 和准确复制操作，不会把 Session 标题当成窗口名称。

旧 `4ad77748` 生产构建在 625px 下可复现内容与导航边界相交、摘要展示短 ID。新增生产构建回归通过 104 项检查，保存 24 张截图，覆盖明暗主题下的 625×825、390×844、320×568、700×600，以及缩小至 400px 高度和恢复桌面宽度。验证实际滚动容器到底后的活动末项与发送操作是否可见且可点击，检查导航切换与完整 ID 复制；不声称原生手机安全区或软键盘实机验收。

![625px 活动末项与独立底部导航](runtime-mobile-625.png)

![完整窗口身份保留在展开详情中](runtime-window-details.png)

![320px 深色协作操作位于导航上方](runtime-mobile-composer.png)

本次后续只改动 Runtime。重新通过类型检查、260 项组件测试、生产构建与生成一致性检查、192 项 Runtime/Admin 浏览器检查。此前未改动的 Desktop/MCP/Rust 证据沿用，不声称重新执行。

## 单一整页滚动条与轻量底栏

[#1216](https://github.com/yyjeqhc/webcodex/issues/1216) 在 `65f67ebb` 下复现：`.app-content` 与固定高度的 `.page` 同时滚动，运行时概览/项目页面重复预留宽滚动槽。窄屏整页视图现在随内容自然增长，由中间主区统一滚动；Agent/侧栏外层也遵循相同规则，活动和消息等明确功能区域保留自己的滚动。唯一整页滚动条使用细线与主题色。底栏与顶部栏使用一致底色、细分隔线和较小留白，不再有额外导航外框或整条悬停底色；对齐用的细滚动槽本身不可滚动。

扩展后的回归在相同四种窄屏尺寸和明暗主题通过 **208 项检查、56 张截图**。实际检查概览、项目和 16 个 Agent 场景的滚动归属与滚轮作用，项目末条 Session、展开的构建诊断、Agent 创建/保存操作的可达性，以及底栏背景和恢复桌面尺寸后的原滚动逻辑。原有活动、协作、身份复制和动画检查保留。此前 104 项外层/窗口验证没有检查子页面滚动，本次补齐这一遗漏。

![625px 深色概览，单一细滚动条和轻量底栏](runtime-mobile-overview.png)

![390px 项目末端内容位于底栏上方](runtime-mobile-projects.png)

## 验证与限制

[验证记录](validation.json)包含检查数量和构建资源摘要。类型检查、前端/Desktop 生产构建通过。组件测试通过：前端 260 项、Desktop 753 项；前端 Node 测试 105 + 23 项、现有 MCP 控制器测试 582 项通过。Rust 定向验证通过：注册表 5 项、Work Result 15 项、资源能力 1 项。格式与生成资源一致性检查通过。

生产构建动画验证在明暗主题各通过 30 项。Runtime/Admin 矩阵通过 192 项，覆盖 1440/390px、明暗和主题色/黑白，以及顶部、滚动、锚点、焦点、弹层、淡色选中态、键盘高亮选项配色和动画。另检查纵向分类在宽屏及响应式网格中保持填充导航；旧实色/下划线候选不能通过新增断言。MCP 浏览器验证在 320/390/800/1440px 共通过 48 个场景，包含宿主主题变化、控件、动画、提交不确定性和清理。

浏览器截图来自真实产品构建/HTML 和本地合成数据 fixture。它们只证明浏览器渲染，**ChatGPT 真实宿主卡片渲染仍未验证**。原生验证覆盖 Linux 源码预览，不代表安装包、Windows/macOS 或发布版本验收。原生二进制标记为前一个 PR 提交加未提交工作区；记录的 Desktop 资源摘要标识实际构建和截图的修正候选。

持续测试版激活是用户另行授权的操作，使用本地部署记录；本次源码提交不包含稳定环境或 Tunnel 变更。本地结果不包含 CI。

## 复现浏览器验证

安装前端、Desktop 和 `scripts/ui-smoke` 依赖后运行：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run test:runtime
npm --prefix frontend run test:admin
npm --prefix frontend run check:dist
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run build
npm --prefix apps/desktop test
node --test src/mcp_tests/*.test.mjs
node scripts/ui-smoke/flowing-selection.mjs
WEBCODEX_MOTION_THEME=dark node scripts/ui-smoke/flowing-selection.mjs
node scripts/ui-smoke/selection-consistency.mjs
node scripts/ui-smoke/mobile-runtime-layout.mjs
node scripts/ui-smoke/mcp-workspaces.mjs
```

可再生报告和截图保存在已忽略的 `artifacts/`；此目录只保存精选公开材料。原生源码预览配置遵循 [Desktop 开发说明](../../DESKTOP_DEVELOPMENT.md)，使用一次性测试目录。
