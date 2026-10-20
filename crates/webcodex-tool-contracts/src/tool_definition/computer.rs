use super::RunnerCapabilityRequirement::FileWrite;
use super::ToolVisibility::ModelVisible;
use super::{
    def, model_spec, permission_risk, require_all_scopes, require_any_scopes, ToolDefinition,
    PERMISSION_RISK_WRITE, TOOL_CATEGORY_COMPUTER,
};
use crate::metadata::{
    ToolPathHint::{Artifact, None as NoPath},
    ToolRisk::{ComputerControl as ComputerControlRisk, ProjectWrite, Read},
    COMPUTER_CONTROL, COMPUTER_LAUNCH, COMPUTER_READ, PROJECT_WRITE, TOOL_PROVIDER_CONTROL,
};

const COMPUTER_CONTROL_GATEWAY_SCOPES: &[&str] = &[COMPUTER_CONTROL, COMPUTER_LAUNCH];

pub(super) const DEFINITIONS: &[ToolDefinition] = &[
    model_spec(
        def(
            "observe_computer",
            super::ToolAuditPolicy::typed_semantic(
                super::ToolAuditSemanticResultPolicy::ComputerObservation,
            ),
            ModelVisible, TOOL_CATEGORY_COMPUTER, None, TOOL_PROVIDER_CONTROL,
            super::ToolSemanticContract { effect: super::ToolEffect::Observe, risk: Read, approval: super::ToolApprovalPolicy::None, idempotency: super::ToolIdempotency::PureRead },
            Some(COMPUTER_READ), false, NoPath, false, false, super::ToolSessionEvidencePolicy::NONE,
        ),
        "Read-only Computer gateway: targets/windows/displays/applications, accessibility_status/accessibility_tree/find_elements/element_state, snapshot_window/snapshot_display, read_clipboard. If action support is unclear, use element_state with exact client_id/surface_id/element_id; can_press/can_focus/can_input_text guide the corresponding control_computer actions. Native eligibility grants no permission/capability; control revalidates. Role/readable value alone is insufficient. Query again only when changed state affects the next decision. element_state preserves observation_generation; stale IDs require fresh tree/search. Tree/search replaces all IDs on that surface, including root_element_id. For truncated searches, choose a branch in a fresh tree and query its latest root_element_id. Scoped reads require an updated Runner and verified scope receipt. Limits: relative depth 8, nodes 256, absolute lineage 32; native deadlines apply. Truncated zero results are inconclusive; unseen siblings beyond the node cap are not paginated. Windows ComboBox value observation grants no focus/input. Exact action scopes, Runner capabilities, protected-content, image/clipboard bounds and snapshot-generation guards apply. No activation, launch, control input, pointer/clipboard writes, project artifact save, shell fallback, or uncertain-effect retry.",
    ),
    require_any_scopes(
        permission_risk(
            model_spec(
                def(
                    "control_computer",
                    super::ToolAuditPolicy::typed_semantic(
                        super::ToolAuditSemanticResultPolicy::ComputerControl,
                    ),
                    ModelVisible, TOOL_CATEGORY_COMPUTER, None, TOOL_PROVIDER_CONTROL,
                    super::ToolSemanticContract { effect: super::ToolEffect::Execute, risk: ComputerControlRisk, approval: super::ToolApprovalPolicy::Standard, idempotency: super::ToolIdempotency::NonIdempotent },
                    None, false, NoPath, true, false, super::ToolSessionEvidencePolicy::NONE,
                ),
                "Effectful Computer gateway: launch_application, activate_window, press, focus, scroll_to_element, key, input_text, pointer_move, pointer_click, write_clipboard. If support is unclear, query observe_computer(action=element_state) with exact client_id/surface_id/element_id; can_press/can_focus/can_input_text guide press/focus/input_text. False means current native conditions are unmet; avoid repeating rejected actions on unchanged state. True grants no permission/capability; control revalidates. Windows press needs InvokePattern; focus/input target only foreground AXTextField; input also needs exact focus, writable empty value. Recheck after focus changes when needed. For key, use exact lowercase schema enums; letters/shortcut strings (Ctrl+P) are unsupported. Shift+Tab uses key=tab, modifiers=[shift]. Windows maps option to Alt; rejects command, option+Tab, option+Escape, any control+Escape chord. macOS uses Shift/Control/Option/Command. Key requires exact surface already foreground/focused, unprotected focus and native preflight; release interfering held keys before re-observing. Exact action scopes, permission/session, Runner capability, native validation and execution-certainty gates apply. No arbitrary argv/path/script, implicit focus/activation, shell fallback, or blind retry after uncertain effects.",
            ),
            PERMISSION_RISK_WRITE,
        ),
        COMPUTER_CONTROL_GATEWAY_SCOPES,
    ),
    require_all_scopes(
        model_spec(
            def(
                "save_computer_snapshot",
                super::ToolAuditPolicy::typed_fields(&[
                    super::ToolAuditResultField::value("project"),
                    super::ToolAuditResultField::value("path"),
                    super::ToolAuditResultField::value("client_id"),
                    super::ToolAuditResultField::value("surface_id"),
                    super::ToolAuditResultField::value("source_width"),
                    super::ToolAuditResultField::value("source_height"),
                    super::ToolAuditResultField::presence("region_present", "region"),
                    super::ToolAuditResultField::value("width"),
                    super::ToolAuditResultField::value("height"),
                    super::ToolAuditResultField::value("mime_type"),
                    super::ToolAuditResultField::value("file_bytes"),
                    super::ToolAuditResultField::value("saved"),
                ]),
                ModelVisible,
                TOOL_CATEGORY_COMPUTER,
                Some(FileWrite),
                TOOL_PROVIDER_CONTROL,
                super::ToolSemanticContract {
                    effect: super::ToolEffect::Mutate,
                    risk: ProjectWrite,
                    approval: super::ToolApprovalPolicy::Standard,
                    idempotency: super::ToolIdempotency::NonIdempotent,
                },
                Some(PROJECT_WRITE),
                true,
                Artifact,
                false,
                false,
                super::ToolSessionEvidencePolicy::NONE,
            ),
            "Save one exact window snapshot as a create-only project artifact without returning image bytes. Reuses observe_computer(action=snapshot_window) region/downscale semantics and requires computer:read plus project:write. No overwrite or encoding control. Unknown writes require artifact-metadata reconciliation before retry.",
        ),
        &[PROJECT_WRITE, COMPUTER_READ],
    ),
];
