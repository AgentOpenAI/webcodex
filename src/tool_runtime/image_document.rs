//! User-visible image presentation uses the existing version-fenced App artifact reader.
use super::image_preview::ImageSource;
use super::project_resolution::ResolvedProject;
use super::{ToolResult, ToolRuntime};
use crate::auth::AuthContext;
use base64::{engine::general_purpose, Engine as _};
use serde_json::json;
use webcodex_core::artifact_policy::{
    MAX_IMAGE_GALLERY_BYTES, MAX_IMAGE_SOURCE_BYTES, MAX_MCP_IMAGE_BYTES,
};
use webcodex_tool_contracts::validate_image_presentation_selection;

pub(super) fn image_error(kind: &str, message: &str) -> ToolResult {
    ToolResult::err_with_output(message, json!({"error_kind": kind, "state_changed": false}))
}

fn image_header_matches(mime: &str, header: &[u8]) -> bool {
    match mime {
        "image/png" => header.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => header.starts_with(b"\xff\xd8\xff"),
        "image/webp" => header.len() >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        _ => false,
    }
}

fn validate_image_path(path: &str) -> Result<(), String> {
    super::files::validate_artifact_file_path(path)?;
    if path.len() > 512 || path.chars().any(char::is_control) || path.contains('\\') {
        return Err("Image path exceeds its presentation bounds".to_string());
    }
    Ok(())
}

fn gallery_file_failure(path: &str, result: &ToolResult) -> serde_json::Value {
    // Keep runtime/Runner details, private current digests and internal paths out
    // of the model/UI. Each file gets a bounded, useful error, never raw stderr.
    let (kind, message) = match result
        .output
        .get("error_kind")
        .and_then(serde_json::Value::as_str)
    {
        Some("not_image") => (
            "not_image",
            "File is not a supported PNG, JPEG or WebP image",
        ),
        Some("image_size_unavailable") => (
            "image_size_unavailable",
            "Image source exceeds the 64 MiB processing limit",
        ),
        Some("snapshot_changed") => (
            "snapshot_changed",
            "Image changed; explicitly reopen this image",
        ),
        Some("image_read_unavailable") => ("image_read_unavailable", "Image could not be read"),
        Some("image_preview_unavailable") => (
            "image_preview_unavailable",
            "Compressed preview could not be prepared; original file is unchanged",
        ),
        _ => (
            "image_unavailable",
            "Image is unavailable or could not be prepared",
        ),
    };
    json!({"path":path,"error_kind":kind,"message":message})
}

impl ToolRuntime {
    pub(crate) async fn present_images(
        &self,
        project: String,
        path: Option<String>,
        paths: Option<Vec<String>>,
        auth: Option<&AuthContext>,
    ) -> ToolResult {
        if let Err(error) = validate_image_presentation_selection(path.as_deref(), paths.as_deref())
        {
            return image_error("invalid_image_selection", &error);
        }
        if let Some(path) = path {
            return self.present_image(project, path, auth).await;
        }
        let paths = paths.expect("validated image selection has paths");
        // Reject every unsafe path before issuing even the first Runner request.
        for path in &paths {
            if let Err(error) = validate_image_path(path) {
                return image_error("policy_rejected", &error);
            }
        }
        let resolved = match self.resolve_project_input_for_auth(&project, auth).await {
            Ok(resolved) => resolved,
            Err(error) => return error.into_tool_result(),
        };
        let mut gallery = Vec::with_capacity(paths.len());
        let mut total_bytes = 0usize;
        let mut prepared = false;
        for path in paths {
            let result = self
                .prepare_image_document(&resolved, path.clone(), auth)
                .await;
            if result.success {
                let document = &result.output["image_document"];
                let bytes = document.get("preview").unwrap_or(document)["bytes"]
                    .as_u64()
                    .unwrap_or(0) as usize;
                total_bytes += bytes;
                prepared = true;
                gallery.push(json!({"image_document":document}));
            } else {
                // A changing/revoked Project must fail the entire selection,
                // rather than become an enumerable per-file permission result.
                if let Err(error) = self
                    .resolve_project_input_for_auth(&resolved.resolved_id, auth)
                    .await
                {
                    return error.into_tool_result();
                }
                gallery.push(gallery_file_failure(&path, &result));
            }
        }
        // Preserve small originals when they fit. If the whole gallery is too
        // large, derive only the largest remaining originals until every slot fits.
        if total_bytes > MAX_IMAGE_GALLERY_BYTES {
            let mut order = (0..gallery.len()).collect::<Vec<_>>();
            order.sort_by_key(|index| {
                std::cmp::Reverse(
                    gallery[*index]["image_document"]["bytes"]
                        .as_u64()
                        .unwrap_or(0),
                )
            });
            for index in order {
                if total_bytes <= MAX_IMAGE_GALLERY_BYTES {
                    break;
                }
                let document = &gallery[index]["image_document"];
                if document.is_null() || document.get("preview").is_some() {
                    continue;
                }
                let bytes = document["bytes"].as_u64().unwrap_or(0) as usize;
                if bytes <= webcodex_core::artifact_policy::MAX_IMAGE_PREVIEW_BYTES {
                    continue;
                }
                let source = ImageSource {
                    project: resolved.resolved_id.clone(),
                    path: document["path"].as_str().unwrap_or_default().to_string(),
                    bytes,
                    sha256: document["sha256"].as_str().unwrap_or_default().to_string(),
                };
                match self.image_preview(source.clone(), auth).await {
                    Ok(preview) => {
                        total_bytes = total_bytes - bytes + preview.bytes.len();
                        gallery[index]["image_document"]["preview"] = preview.descriptor;
                    }
                    Err(_) => {
                        if let Err(error) = self
                            .resolve_project_input_for_auth(&resolved.resolved_id, auth)
                            .await
                        {
                            return error.into_tool_result();
                        }
                        total_bytes -= bytes;
                        gallery[index] = json!({"path":source.path,"error_kind":"image_preview_unavailable","message":"Compressed preview could not be prepared; original file is unchanged"});
                    }
                }
            }
            prepared = gallery
                .iter()
                .any(|item| item.get("image_document").is_some());
        }
        if prepared {
            ToolResult::ok(json!({"image_gallery":gallery}))
        } else {
            ToolResult::err_with_output(
                "No selected images could be prepared",
                json!({"image_gallery":gallery,"error_kind":"no_images_available","state_changed":false}),
            )
        }
    }

    pub(crate) async fn present_image(
        &self,
        project: String,
        path: String,
        auth: Option<&AuthContext>,
    ) -> ToolResult {
        if let Err(error) = validate_image_path(&path) {
            return image_error("policy_rejected", &error);
        }
        let resolved = match self.resolve_project_input_for_auth(&project, auth).await {
            Ok(resolved) => resolved,
            Err(error) => return error.into_tool_result(),
        };
        self.prepare_image_document(&resolved, path, auth).await
    }

    async fn prepare_image_document(
        &self,
        resolved: &ResolvedProject,
        path: String,
        auth: Option<&AuthContext>,
    ) -> ToolResult {
        let metadata = self
            .export_project_artifact_metadata_resolved(resolved, path.clone(), auth)
            .await;
        if !metadata.success {
            return metadata;
        }
        let bytes = metadata.output["bytes"].as_u64().unwrap_or(0) as usize;
        let mime = metadata.output["mime_type"].as_str().unwrap_or_default();
        if !matches!(mime, "image/png" | "image/jpeg" | "image/webp") {
            return image_error("not_image", "Select a PNG, JPEG or WebP image");
        }
        if !(12..=MAX_IMAGE_SOURCE_BYTES).contains(&bytes) {
            return image_error(
                "image_size_unavailable",
                "Image source exceeds the 64 MiB processing limit",
            );
        }
        let sha256 = metadata.output["sha256"].as_str().unwrap_or_default();
        let header = match self
            .read_project_artifact_export_chunk_internal(
                &resolved.resolved_id,
                &path,
                bytes,
                sha256,
                0,
                12,
                auth,
            )
            .await
        {
            Ok(output) => output,
            Err(_) => return image_error("image_read_unavailable", "Image could not be read"),
        };
        if header["error_kind"] == "snapshot_changed" {
            return image_error(
                "snapshot_changed",
                "Image changed; explicitly reopen the image",
            );
        }
        let decoded = header["content_base64"]
            .as_str()
            .and_then(|value| general_purpose::STANDARD.decode(value).ok());
        if !decoded
            .as_deref()
            .is_some_and(|data| data.len() == 12 && image_header_matches(mime, data))
        {
            return image_error(
                "not_image",
                "File content does not match a supported image header",
            );
        }
        let mut document = json!({
            "project": resolved.resolved_id, "path": path, "name": metadata.output["name"],
            "bytes": bytes, "sha256": sha256, "mime_type": mime,
        });
        if bytes > MAX_MCP_IMAGE_BYTES {
            match self
                .image_preview(
                    ImageSource {
                        project: resolved.resolved_id.clone(),
                        path,
                        bytes,
                        sha256: sha256.to_string(),
                    },
                    auth,
                )
                .await
            {
                Ok(preview) => document["preview"] = preview.descriptor,
                Err(_) => {
                    return image_error(
                        "image_preview_unavailable",
                        "Compressed preview could not be prepared; original file is unchanged",
                    )
                }
            }
        }
        ToolResult::ok(json!({"image_document":document}))
    }
}
