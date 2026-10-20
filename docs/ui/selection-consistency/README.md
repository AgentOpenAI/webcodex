# Consistent selection and controls

[简体中文](README.zh-CN.md)

Implements [#1211](https://github.com/yyjeqhc/webcodex/issues/1211). The earlier
[#1172](https://github.com/yyjeqhc/webcodex/issues/1172),
[#1174](https://github.com/yyjeqhc/webcodex/issues/1174),
[#1186](https://github.com/yyjeqhc/webcodex/issues/1186) and
[#1198](https://github.com/yyjeqhc/webcodex/issues/1198) are completed historical
UI work; this is the new cross-surface selection and controls scope.

Selected controls now use a pale accent background and readable accent text/icons by default. Web appearance menus,
Desktop General settings and card appearance settings offer accent or monochrome.
Monochrome reverses with light/dark appearance and retains the saved accent.
Runtime/Admin share local storage on their origin; Desktop and MCP iframe
origins/Host storage partitions retain their own choices. Blocked storage keeps a
usable in-memory choice. No server preference API or authority state is added.

Navigation and compact mutually exclusive choices use a rounded filled plate.
Vertical Settings/Extensions categories remain filled navigation, including their
responsive grid. Only horizontal content-tab rows use a rounded 3px underline
matching their text and icons. Horizontal placement alone does not turn primary
navigation such as Home/Goals into content tabs. Both use
the shared 260ms controller, at most 3% stretch and stationary labels. Reversals
continue from visible geometry. Paint-time card reflow corrects the destination
without cancelling active motion; responsive changes recalibrate the containing
block. Reduced motion disables movement; forced colors retain platform selection
and focus. Status, danger and ordinary action colors retain their semantics.

React ordinary selectors use Mantine Select. Framework-free cards use a shared
portal listbox retaining the native select's form/value/event ownership. Arrow
keys, Enter, Escape, focus return, disabled options, scrolling and narrow popup
positioning are covered. Inputs have rounded borders/focus, and composers show
their focus ring around the rounded outer shell.

## Four reported areas

1. Runtime Goals/Activity now occupies a compact full-width header. Both panels
   begin on the same row; Window/Collaboration uses an underline.

   ![Pale blue Runtime navigation and horizontal underline tabs](runtime-activity-light.png)

   ![Aligned Runtime panels in dark appearance](runtime-activity-dark.png)

2. Collaboration uses a themed popup and rounded composer focus.

   ![Runtime collaboration dropdown](runtime-composer-dropdown.png)

3. Admin fills the available content width with one consistent sidebar gutter.
   The sidebar sticks, the main title scrolls, and summary cards remain separate.
   Anchor navigation includes fractional-pixel landing tolerance.

   ![Admin at the top](admin-top.png)

   ![Admin after navigating to Runners](admin-scrolled.png)

4. MCP Home/Goals uses the real shared filled controller. Work Result content and
   spreadsheet sheet navigation use underlines. The first-party generator emits
   self-contained HTML; affected resources advance to Workbench v8, Work Result
   v33 and spreadsheet v4.

   ![MCP Home/Goals](workbench-home-goals.png)

   ![Work Result themed picker in a narrow viewport](work-result-dropdown.png)

## Appearance, responsive and motion evidence

![Runtime monochrome in dark appearance](runtime-monochrome.png)

![Runtime mobile layout](runtime-mobile.png)

![Admin mobile anchor in monochrome](admin-mobile.png)

![MCP local monochrome setting at 320px](workbench-mobile-monochrome.png)

![Paused Runtime tab transition](runtime-mid-motion.png)

Recordings contain real browser interactions and paused intermediate frames used
by assertions: [Runtime motion](runtime-motion.webm),
[MCP Workbench motion](workbench-motion.webm).

## Native Linux evidence

The native dogfood binary ran in the unlocked Linux graphical session, using its
real WebKitGTK renderer and Tauri backend. A disposable loopback Server/Runner,
synthetic user/project, separate configuration/data roots and private D-Bus kept
the viewer isolated. Exact executable/build identities, listener ownership and
temporary Runner identity were checked locally. No Tunnel or services were
installed. All owned processes and temporary credentials/state were cleaned.

Actual native input opened Settings and the popup, selected monochrome with
ArrowDown/Enter, switched to dark appearance, cancelled a different highlighted
choice with Escape and resized the window from 1180 to 800px. These images are
native window captures, not browser fixtures:

![Native Desktop pale category navigation](desktop-native-navigation.png)

![Native Desktop selection popup](desktop-native-appearance.png)

![Native Desktop dark monochrome](desktop-native-dark-monochrome.png)

![Native Desktop at 800px](desktop-native-narrow.png)

## Mobile content boundary and Window details

The follow-up defects in [#1215](https://github.com/yyjeqhc/webcodex/issues/1215)
are corrected in the same open UI PR. On narrow screens the header, main scroll
region and bottom navigation occupy separate viewport rows. A subtle divider and an opaque footer matching the header separate navigation
from content, with matching thin gutters even when classic scrollbars occupy space. Its safe-area padding participates in layout instead of
covering content. The collapsed Window details entry no longer includes an opaque
key; expanded details retain the full exact Window ID and copy action. No Window
name is inferred from a Session title.

The old `4ad77748` production bundles reproduce intersecting content/navigation
bounds at 625px and the abbreviated identity in the summary. The new production
regression passes 104 checks with 24 captures over 625×825, 390×844, 320×568 and
700×600 in both themes, including a 400px viewport shrink and desktop resize.
It scrolls owning containers to their actual end and hit-tests the final activity
and composer actions, verifies navigation switching, and copies the exact Window
key. Native phone safe-area and virtual-keyboard behavior are not claimed.

![625px activity ending above the separated navigation](runtime-mobile-625.png)

![Full Window identity remains inside expanded details](runtime-window-details.png)

![320px dark collaboration action above navigation](runtime-mobile-composer.png)

Only Runtime code changes in this follow-up. Its typecheck, 260 component tests,
production build/generated checks and 192 Runtime/Admin browser checks passed
again. Earlier unchanged Desktop/MCP/Rust evidence above is retained, not rerun.

## One mobile page scrollbar and a lighter footer

The regression in [#1216](https://github.com/yyjeqhc/webcodex/issues/1216)
was reproduced at `65f67ebb`: both `.app-content` and its fixed-height `.page`
scrolled, reserving two wide gutters on Overview/Projects. Narrow page surfaces
now grow within the main scroll owner; Agent/sidebar wrappers follow the same
rule while activity and message panes retain their explicit scrolling regions.
The single whole-page scrollbar is thin and themed. The footer matches the header
surface with a subtle divider, less padding, and no extra navigation frame or
whole-strip hover background. Its aligned thin gutter never scrolls.

The expanded regression passes **208 checks / 56 captures** across the same
four narrow sizes and both themes. It checks actual owner ranges and wheel
routing on Overview, Projects and a 16-Agent fixture; final Project Sessions,
expanded build diagnostics and Agent create/profile actions; the footer surface;
and restored desktop page scroll ownership after resizing. The original activity,
composer, identity/copy and motion checks remain. This closes the gap in the earlier
104-check shell/Window validation, which did not inspect child page scrolling.

![625px dark Overview with one thin scrollbar and flat footer](runtime-mobile-overview.png)

![390px Project content reachable above the footer](runtime-mobile-projects.png)

## Validation and limits

See the compact [validation record](validation.json) for counts and bundle
digests. Typechecks and production frontend/Desktop builds pass. Component tests
pass: 260 frontend and 753 Desktop; frontend Node suites pass 105 + 23 tests;
existing MCP controller suites pass 582. Focused Rust checks pass 5 registry,
15 Work Result and 1 resource capability test. Formatting and generated-resource
consistency checks pass.

The production-bundle motion harness passes 30 checks in each light/dark theme.
The Runtime/Admin matrix passes 192 checks and covers 1440/390px, light/dark and accent/monochrome,
including top/scroll/anchor, focus, popup, pale selection, keyboard-highlighted
option colors and animation behavior. Vertical category navigation is also checked
at desktop and responsive-grid widths; the previous saturated/underline candidate
fails these new assertions. MCP browser
coverage passes 48 cases at 320/390/800/1440px, including Host theme changes,
controls, motion, uncertain submissions and teardown.

Browser screenshots use public synthetic data with loopback fixtures and the
actual shipped bundles/HTML. They establish browser rendering, not ChatGPT Host
acceptance. **Real ChatGPT card rendering remains unverified.** Native validation
covers Linux source preview, not an installed package, Windows/macOS, or a release.
Native binaries identify the preceding PR head plus dirty worktree; recorded
Desktop asset hashes identify the corrected native candidate that was built and captured.

Persistent test activation is a separately authorized operator action with local
deployment records. No stable environment or Tunnel change is included in this
source submission. CI is not included in these local results.

## Reproduce browser checks

After installing the frontend, Desktop and `scripts/ui-smoke` dependencies:

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

Regenerable reports/screenshots stay in ignored `artifacts/`; this directory
contains the curated public captures. For native source-preview setup, follow
[Desktop development](../../DESKTOP_DEVELOPMENT.md) with disposable test roots.
