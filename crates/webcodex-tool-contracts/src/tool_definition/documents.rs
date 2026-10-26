use super::*;
use crate::metadata::{ToolPathHint::Artifact, ToolRisk::Read, PROJECT_READ};

pub(super) const DEFINITIONS: &[ToolDefinition] = &[
    adaptive_runtime_direct(
        model_spec(
            document_read_definition("present_image", ToolVisibility::ModelVisible, ToolIdempotency::NonIdempotent),
            "Show authorized Project-relative PNG, JPEG or WebP images in one MCP App. Supply exactly one of path (one image) or paths (ordered 1..16 distinct image paths). For a multi-image request, collect all exact saved paths, then call once with paths: repeated single-image calls do not guarantee multiple visible Host cards. Originals up to 4 MiB display directly when display budgets fit; high-pixel originals adapt to labeled UI previews. Larger originals (up to 64 MiB/64 Mi pixels) automatically get a labeled compressed preview; a batch over 32 MiB is fitted with previews rather than omitted images. Originals stay unchanged. Duplicate/unsafe inputs fail. A per-file preparation/read/decode failure has its own visible error slot while other images remain; all preparation failures return success=false with the gallery errors. Pins exact size/SHA-256/MIME and privately reads bounded chunks. Changed content fails closed; reopen explicitly to select its new version. The user must retain source files for historical cards. No Git/Session required. inspect_project_artifact(action=image) is model observation, not user-visible proof. Rendering requires an MCP Apps Host; without Apps, report preview unavailable. Never expose public image URLs or complete model-facing Base64. If more than 16 images are requested, explain the limit and agree on separate batches or file export; never silently omit images.",
        ),
        159,
        ToolDirectReason::Presentation,
    ),
    adaptive_runtime_direct(
        model_spec(
            document_read_definition("present_pdf", ToolVisibility::ModelVisible, ToolIdempotency::NonIdempotent),
            "Open one PDF in a dedicated MCP App reader with no work activity, changes or collaboration panels. Use when the user asks to view a PDF; use present_work_result for substantial coding progress. Supply an authorized Project and project-relative path, including unchanged/untracked files; no Git or Session required. Pins size/SHA-256 (maximum 20 MiB), validates the PDF header, and never edits or exports the file. The App privately reads bounded chunks and fails if the version changes; reopen explicitly to select a new version. Rendering requires an MCP Apps Host. Repeat calls may create another Host card; retry inside the reader keeps the selected version.",
        ),
        156,
        ToolDirectReason::Presentation,
    ),
    document_read_definition("read_app_artifact_chunk", ToolVisibility::ModelHidden, ToolIdempotency::PureRead),
];

const DOCUMENT_AUDIT_FIELDS: &[ToolAuditResultField] = &[ToolAuditResultField::value("error_kind")];

const fn document_read_definition(
    name: &'static str,
    visibility: ToolVisibility,
    idempotency: ToolIdempotency,
) -> ToolDefinition {
    def(
        name,
        ToolAuditPolicy::typed_fields(DOCUMENT_AUDIT_FIELDS),
        visibility,
        TOOL_CATEGORY_ARTIFACT,
        Some(RunnerCapabilityRequirement::FileRead),
        TOOL_PROVIDER_CONTROL,
        ToolSemanticContract {
            effect: ToolEffect::Observe,
            risk: Read,
            approval: ToolApprovalPolicy::None,
            idempotency,
        },
        Some(PROJECT_READ),
        true,
        Artifact,
        false,
        false,
        ToolSessionEvidencePolicy::NONE,
    )
    .with_activity(
        ToolActivityPresentation::Transport,
        ToolActivityInteraction::NonMeaningful,
    )
}
