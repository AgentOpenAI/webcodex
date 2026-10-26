# Project image preview and local deployment

`present_image` opens one MCP App for explicitly selected authorized PNG, JPEG or
WebP files. Use exactly one of `path` (the existing single-image contract) or
`paths` (1–16 images in the same Project, in the requested order). Originals up to 4 MiB display unchanged when the batch fits. Larger originals
(up to 64 MiB / 67,108,864 input pixels) automatically get a WebP preview capped
at 2 MiB and a 2048-pixel edge. EXIF orientation and alpha are preserved; animated
sources are labeled as static previews. The 32 MiB batch budget counts rendered
bytes; larger originals are fitted with previews without dropping request slots. No Git changes or Workflow Session are required.
`inspect_project_artifact(action=image)` supplies model observation and does not
prove that the user can see an image in their Host.

The App reuses the App-only `read_app_artifact_chunk` transport with 512 KiB
private chunks, exact Project/path/size/SHA-256 binding, complete digest and
signature checks, and visible decode/stale/read failures. Retry retains the
selected version. Fit/original-size controls leave source files unchanged. No
public server image URL or model-generated Base64 is used.

For multiple images, first collect their exact saved paths, then call
`present_image(project, paths)` once. The gallery renders every requested slot in
one UI with independent image, error and retry state. Repeated single
calls are not a guarantee that the Host retains multiple visible widgets. Invalid
paths, ambiguous selection and duplicate normalized paths are rejected before
file reads. A missing or unsupported file retains an error slot rather than
discarding other requested images; complete failure remains a business failure.
Changing or deleting one source file cannot silently replace it with another.
The UI bounds parallel reads to two and retained decoded pixels to 67,108,864.

The current gallery resource is `ui://webcodex/image/v5`. Existing ChatGPT
historical cards that request v1, v2, v3 or v4 receive the same current read-only
renderer; their single-image and gallery result shapes remain readable. A server
update cannot erase an old card already cached by the client. Refresh the Host's
tool schema and present images again to use v5. The server never infers a gallery
from prior requests or a ClientWindow.

Chat attachments retain the canonical `import_host_files` path. The independent
loopback OpenAI Tunnel explicitly opts in with
`WEBCODEX_MCP_TRUST_LOOPBACK_API_TOKEN_FILE_IMPORT=true`; authorization, path,
HTTPS, size and provenance checks remain. The existing `managed-browser-mcp`
is registered as a Runner `[mcp]` provider and retains its own profile/lock data.
The local `scripts/managed_browser_gateway.cjs` adapter also returns standard
MCP image content for named screenshots and reports `screenshot_project_path`.
Each screenshot retains its own file under `artifacts/managed-browser` by default;
the configured workspace directory is unchanged. Names contain Shanghai time
(`YYYY-MM-DD_HH-mm-ss-SSS`) and a random UUID. An exclusive file reservation prevents
overwriting even on a name collision; only name allocation is retried. `filename`
is a hint whose directory, stem and image extension are retained with the unique
suffix added. Always follow the returned `screenshot_project_path`, not the hint.
Old files are retained for historical cards; deleting a source file still prevents
the corresponding card from reloading. Runtime screenshots are Git-ignored and
must not be treated as disposable test output. Use `present_image` for user-visible display. Calls remain
serial, effects are never retried, and disconnect closes only the bound profile.

The operator-only `scripts/deploy_local_runtime.py` targets this existing Linux
systemd installation, not Core Environment or a package-manager migration.
Build the three binaries from a clean commit with the dogfood profile. `preflight`
uses SQLite backup and a temporary data copy, boots the verified official ARM64
0.4.6 bridge for older installations, then boots the candidate and checks database
integrity. Production remains running. `apply` repeats preflight, refuses active
Jobs, stops existing services/socket, snapshots the current installation, repeats
the verified data transition and switches the three binaries. It enables the
explicit attachment trust option and registers the existing browser manager.

Only `/var/backups/webcodex/previous` is retained. A complete new snapshot replaces
the older rollback point. `previous.next` means an incomplete transaction and
requires reconciliation. Switching/migration failures restore the just-replaced
binaries, data and configuration; service units and user linger stay unchanged.
Explicit `rollback` restores the previous data snapshot too, so later service data
is overwritten. See the [Chinese operator commands](project-image-preview.zh-CN.md).

Focused Rust tests cover ownership, unsafe paths, stale content and MIME spoofing.
`node --test scripts/tests/managed_browser_screenshot.test.cjs` checks same-time and
explicit-filename uniqueness, forced collisions, path boundaries and saved-file
delivery including oversized screenshots. The browser smoke captures twice with
the same filename hint and verifies that the first file is unchanged.
Python tests cover one-backup retention, failed migration recovery and refusal to
restore a stale backup after snapshot failure. The native Chromium smoke checks
mobile/desktop rendering, corrupt/stale failures and retry. Multi-image
acceptance also checks 1, 2 and 16 requested slots, their order and visibility,
rejection above the count/size limits, partial failures and a new result replacing
an in-flight gallery. These fixtures do not replace
real ChatGPT Host/attachment acceptance.

Before a local `main-my` build, follow the mandatory security and post-acceptance
cleanup gates in [AGENTS.md](../../AGENTS.md#6-main-my-本机维护约束). Unresolved
unauthorized access, control or exfiltration risks block builds and deployments.
Clean only task-owned temporary artifacts after successful acceptance, retain
dependency/incremental caches and user data, and keep only one previous rollback.

## Automatic Sharp previews

The local deployment reuses installed Node/Sharp via absolute operator settings
`WEBCODEX_IMAGE_PREVIEW_NODE` and `WEBCODEX_IMAGE_PREVIEW_SHARP_PACKAGE`.
The embedded fixed worker consumes authorized stdin bytes, not model paths/URLs.
It clears inherited environment, bounds I/O, owns its process tree, and has a
30-second process deadline within a 90-second preparation deadline. Cancellation
terminates only its owned tree. No new tooling is installed.

Original identity stays canonical; `image_document.preview` describes derived
bytes, and the private reader's optional `image_preview` selection pins that
exact preview while retaining the outer source size/SHA. The non-authoritative
cache holds at most 32 entries/64 MiB for 30 minutes and never writes Projects.
Every use rechecks source authority and version. Misses regenerate from that exact
source; a differing encoder result fails closed. UI labels distinguish compressed
previews from unchanged originals. Gallery chunks share the two-read limit.
Corrupt/over-budget sources fail visibly.

```bash
node --test scripts/tests/image_preview.test.cjs
node scripts/ui-smoke/image-gallery.mjs
```

High-pixel small originals additionally fit a per-image share in the UI while leaving source files unchanged. Declared PNG/JPEG/WebP dimensions are checked before browser decode; the per-image 67,108,864-pixel guard and aggregate retained pixel budget remain. Non-cancellable canvas encoding retains its slot until callback drain; late results cannot retarget a new gallery.


## ChatGPT approval versus WebCodex authority

ChatGPT action approval is separate from server authentication and WebCodex
`authority.mode`. Local `trusted_agent` does not require server human approval;
it does not suppress ChatGPT prompts, including in a fresh conversation. Image
tools retain truthful read-only annotations; commands, scripts and the generic
gateway retain their effects rather than pretending to be read-only.
Inspect saved permissions in ChatGPT Settings → Apps/Plugins → the WebCodex app
or connected account → Permissions. Available allow-all settings, persistence
across conversations and additional safety review depend on the account,
workspace and Host policy. The server cannot promise to override them.
Collect the exact card text, tool name and connection before diagnosing repeated
prompts; do not relax authentication or execution authority as a workaround.
