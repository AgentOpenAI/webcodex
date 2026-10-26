use super::support::artifacts::{complete_artifact_chunk, setup_artifact_reader};
use super::support::*;
use serde_json::json;
use sha2::{Digest, Sha256};

async fn complete_image_metadata(
    runtime: &crate::tool_runtime::ToolRuntime,
    client: &str,
    path: &str,
    output: serde_json::Value,
) {
    let request = wait_for_patch_agent_request(runtime, client).await;
    assert_eq!(request.kind, "file_read_project_artifact_metadata");
    let payload: serde_json::Value =
        serde_json::from_str(request.content.as_deref().unwrap()).unwrap();
    assert_eq!(payload["path"], path);
    complete_patch_agent_request(
        runtime,
        client,
        &request.request_id,
        0,
        &output.to_string(),
        "",
    )
    .await;
}

fn image_metadata(path: &str, data: &[u8], mime: &str) -> serde_json::Value {
    json!({"path":path,"bytes":data.len(),"sha256":format!("{:x}",Sha256::digest(data)),"mime_type":mime})
}

fn assert_gallery_schema(result: &crate::tool_runtime::ToolResult) {
    webcodex_tool_contracts::test_support::validate_schema_instance(
        &json!({"success":result.success,"output":result.output,"error":result.error}),
        &webcodex_tool_contracts::output_schema_for_tool("present_image"),
    )
    .unwrap();
}

#[tokio::test]
async fn image_document_pins_bytes_and_rejects_mime_spoofing_or_stale_files() {
    let (runtime, auth, project) = setup_artifact_reader("image-open").await;
    let data = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    for (mime, stale, expected) in [
        ("image/png", false, None),
        ("image/jpeg", false, Some("not_image")),
        ("image/png", true, Some("snapshot_changed")),
    ] {
        let task = tokio::spawn({
            let runtime = runtime.clone();
            let auth = auth.clone();
            let project = project.clone();
            async move {
                runtime
                    .present_image(project, "logo.png".into(), Some(&auth))
                    .await
            }
        });
        let request = wait_for_patch_agent_request(&runtime, "image-open").await;
        assert_eq!(request.kind, "file_read_project_artifact_metadata");
        complete_patch_agent_request(&runtime, "image-open", &request.request_id, 0,
            &json!({"path":"logo.png", "bytes":data.len(), "sha256":format!("{:x}",Sha256::digest(data)), "mime_type":mime}).to_string(), "").await;
        complete_artifact_chunk(&runtime, "image-open", "logo.png", data, 0, 12, stale).await;
        let result = task.await.unwrap();
        if let Some(kind) = expected {
            assert!(!result.success);
            assert_eq!(result.output["error_kind"], kind);
        } else {
            assert!(result.success, "{:?}", result.error);
            assert_eq!(result.output["image_document"]["bytes"], data.len());
            assert_eq!(
                result.output["image_document"]["sha256"],
                format!("{:x}", Sha256::digest(data))
            );
            assert!(!result.output.to_string().contains("content_base64"));
        }
        assert!(!result.output.to_string().contains("private-current-digest"));
    }
}

#[tokio::test]
async fn image_document_denies_foreign_owner_and_unsafe_path_before_io() {
    let (runtime, _, project) = setup_artifact_reader("image-owner").await;
    let auth = managed_oauth_auth_context("bob", None);
    for path in ["logo.png", "../private.png", "/tmp/logo.png"] {
        let result = runtime
            .present_image(project.clone(), path.into(), Some(&auth))
            .await;
        assert!(!result.success);
    }
}

#[tokio::test]
async fn image_gallery_rejects_invalid_selection_and_all_unsafe_paths_before_io() {
    let (runtime, auth, project) = setup_artifact_reader("image-selection").await;
    let cases = [
        (None, None),
        (Some("a.png".into()), Some(vec!["b.png".into()])),
        (None, Some(Vec::new())),
        (None, Some((0..17).map(|i| format!("{i}.png")).collect())),
        (None, Some(vec!["a.png".into(), "./a.png".into()])),
        (None, Some(vec!["safe.png".into(), "../private.png".into()])),
        (
            None,
            Some(vec!["safe.png".into(), "/tmp/private.png".into()]),
        ),
        (None, Some(vec!["safe.png".into(), ".env".into()])),
        (
            None,
            Some(vec!["safe.png".into(), "nested\\image.png".into()]),
        ),
    ];
    for (path, paths) in cases {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            runtime.present_images(project.clone(), path, paths, Some(&auth)),
        )
        .await
        .expect("invalid selection must fail before Runner IO");
        assert!(!result.success);
        assert!(probe_patch_agent_request(&runtime, "image-selection")
            .await
            .is_none());
    }
    let foreign = managed_oauth_auth_context("bob", None);
    let denied = runtime
        .present_images(
            project,
            None,
            Some(vec!["a.png".into(), "b.png".into()]),
            Some(&foreign),
        )
        .await;
    assert!(!denied.success);
    assert!(denied.output.get("image_gallery").is_none());
    assert!(probe_patch_agent_request(&runtime, "image-selection")
        .await
        .is_none());
}

#[tokio::test]
async fn image_gallery_keeps_order_and_other_images_when_a_file_is_missing_or_oversized() {
    let client = "image-partial";
    let (runtime, auth, project) = setup_artifact_reader(client).await;
    let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    let jpeg = b"\xff\xd8\xff\0\0\0\0\0\0\0\0\0";
    let paths = ["first.png", "missing.png", "oversized.png", "last.jpg"];
    let task = tokio::spawn({
        let runtime = runtime.clone();
        let auth = auth.clone();
        async move {
            runtime
                .present_images(
                    project,
                    None,
                    Some(paths.into_iter().map(str::to_string).collect()),
                    Some(&auth),
                )
                .await
        }
    });
    complete_image_metadata(
        &runtime,
        client,
        "first.png",
        image_metadata("first.png", png, "image/png"),
    )
    .await;
    complete_artifact_chunk(&runtime, client, "first.png", png, 0, 12, false).await;
    complete_image_metadata(
        &runtime,
        client,
        "missing.png",
        json!({"error":"private credential detail /server/internal-path"}),
    )
    .await;
    let mut oversized = image_metadata("oversized.png", png, "image/png");
    oversized["bytes"] = json!(webcodex_core::artifact_policy::MAX_IMAGE_SOURCE_BYTES + 1);
    complete_image_metadata(&runtime, client, "oversized.png", oversized).await;
    complete_image_metadata(
        &runtime,
        client,
        "last.jpg",
        image_metadata("last.jpg", jpeg, "image/jpeg"),
    )
    .await;
    complete_artifact_chunk(&runtime, client, "last.jpg", jpeg, 0, 12, false).await;
    let result = task.await.unwrap();
    assert!(result.success, "{:?}", result.error);
    let gallery = result.output["image_gallery"].as_array().unwrap();
    assert_eq!(gallery.len(), 4);
    assert_eq!(gallery[0]["image_document"]["path"], paths[0]);
    assert_eq!(gallery[1]["path"], paths[1]);
    assert_eq!(gallery[1]["error_kind"], "image_unavailable");
    assert_eq!(gallery[2]["path"], paths[2]);
    assert_eq!(gallery[2]["error_kind"], "image_size_unavailable");
    assert_eq!(gallery[3]["image_document"]["path"], paths[3]);
    assert!(!result.output.to_string().contains("private credential"));
    assert!(!result.output.to_string().contains("internal-path"));
    assert!(!result.output.to_string().contains("content_base64"));
    assert_gallery_schema(&result);
}

#[tokio::test]
async fn image_gallery_all_failed_still_returns_each_requested_error_slot() {
    let client = "image-all-failed";
    let (runtime, auth, project) = setup_artifact_reader(client).await;
    let task = tokio::spawn({
        let runtime = runtime.clone();
        let auth = auth.clone();
        async move {
            runtime
                .present_images(
                    project,
                    None,
                    Some(vec!["a.png".into(), "b.png".into()]),
                    Some(&auth),
                )
                .await
        }
    });
    for path in ["a.png", "b.png"] {
        complete_image_metadata(
            &runtime,
            client,
            path,
            json!({"error":"private missing-file detail"}),
        )
        .await;
    }
    let result = task.await.unwrap();
    assert!(!result.success);
    assert_eq!(result.output["error_kind"], "no_images_available");
    assert_eq!(result.output["image_gallery"].as_array().unwrap().len(), 2);
    assert!(!result.output.to_string().contains("private missing-file"));
    assert_gallery_schema(&result);
}

#[tokio::test]
async fn image_gallery_supports_sixteen_distinct_paths_even_when_image_bytes_match() {
    let client = "image-sixteen";
    let (runtime, auth, project) = setup_artifact_reader(client).await;
    let data = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    let paths = (0..16).map(|i| format!("{i}.png")).collect::<Vec<_>>();
    let task = tokio::spawn({
        let runtime = runtime.clone();
        let auth = auth.clone();
        let paths = paths.clone();
        async move {
            runtime
                .present_images(project, None, Some(paths), Some(&auth))
                .await
        }
    });
    for path in &paths {
        complete_image_metadata(
            &runtime,
            client,
            path,
            image_metadata(path, data, "image/png"),
        )
        .await;
        complete_artifact_chunk(&runtime, client, path, data, 0, 12, false).await;
    }
    let result = task.await.unwrap();
    assert!(result.success);
    let gallery = result.output["image_gallery"].as_array().unwrap();
    assert_eq!(gallery.len(), 16);
    for (item, path) in gallery.iter().zip(paths) {
        assert_eq!(item["image_document"]["path"], path);
    }
    assert_gallery_schema(&result);
}

#[tokio::test]
async fn image_gallery_total_budget_keeps_originals_or_fits_with_pinned_previews() {
    let mut data = vec![0u8; 4 * 1024 * 1024];
    data[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    for count in [8, 9] {
        let client = format!("image-total-{count}");
        let (runtime, auth, project) = setup_artifact_reader(&client).await;
        let paths = (0..count).map(|i| format!("{i}.png")).collect::<Vec<_>>();
        if count == 9 {
            for path in paths.iter().take(2) {
                runtime.presentation.image_previews.insert(
                    super::super::image_preview::ImageSource {
                        project: project.clone(),
                        path: path.clone(),
                        bytes: data.len(),
                        sha256: format!("{:x}", Sha256::digest(&data)),
                    },
                    fake_image_preview(),
                );
            }
        }
        let task = tokio::spawn({
            let runtime = runtime.clone();
            let auth = auth.clone();
            let paths = paths.clone();
            async move {
                runtime
                    .present_images(project, None, Some(paths), Some(&auth))
                    .await
            }
        });
        for path in &paths {
            complete_image_metadata(
                &runtime,
                &client,
                path,
                image_metadata(path, &data, "image/png"),
            )
            .await;
            complete_artifact_chunk(&runtime, &client, path, &data, 0, 12, false).await;
        }
        if count == 9 {
            for path in paths.iter().take(2) {
                complete_artifact_chunk(&runtime, &client, path, &data, 0, 12, false).await;
            }
        }
        let result = task.await.unwrap();
        assert!(result.success, "{:?}", result.error);
        let gallery = result.output["image_gallery"].as_array().unwrap();
        assert_eq!(gallery.len(), count);
        assert_eq!(
            gallery
                .iter()
                .filter(|item| item["image_document"].get("preview").is_some())
                .count(),
            if count == 9 { 2 } else { 0 }
        );
        assert_gallery_schema(&result);
    }
}

fn fake_image_preview() -> super::super::image_preview::Preview {
    let bytes = b"RIFF\0\0\0\0WEBP".to_vec();
    super::super::image_preview::Preview {
        descriptor: json!({"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes)),"mime_type":"image/webp","width":1,"height":1,"static_frame":false}),
        bytes: std::sync::Arc::new(bytes),
    }
}

#[tokio::test]
async fn image_document_preview_rechecks_source_after_waiting_for_another_worker() {
    let client = "image-preview-wait";
    let (runtime, auth, project) = setup_artifact_reader(client).await;
    let data = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    let source = super::super::image_preview::ImageSource {
        project,
        path: "wait.png".into(),
        bytes: data.len(),
        sha256: format!("{:x}", Sha256::digest(data)),
    };
    let permit = runtime
        .presentation
        .image_previews
        .gate
        .clone()
        .acquire_owned()
        .await
        .unwrap();
    let task = tokio::spawn({
        let runtime = runtime.clone();
        let auth = auth.clone();
        let source = source.clone();
        async move { runtime.image_preview(source, Some(&auth)).await }
    });
    complete_artifact_chunk(&runtime, client, "wait.png", data, 0, 12, false).await;
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runtime.presentation.image_previews.wait_started.notified(),
    )
    .await
    .unwrap();
    runtime
        .presentation
        .image_previews
        .insert(source, fake_image_preview());
    drop(permit);
    complete_artifact_chunk(&runtime, client, "wait.png", data, 0, 12, true).await;
    assert!(task.await.unwrap().is_err());
}

#[tokio::test]
async fn image_document_large_source_uses_preview_but_pins_original_and_rechecks_auth() {
    let client = "image-large-preview";
    let (runtime, auth, project) = setup_artifact_reader(client).await;
    let mut data = vec![0; 5 * 1024 * 1024];
    data[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let source = super::super::image_preview::ImageSource {
        project: project.clone(),
        path: "large.png".into(),
        bytes: data.len(),
        sha256: format!("{:x}", Sha256::digest(&data)),
    };
    let preview = fake_image_preview();
    runtime
        .presentation
        .image_previews
        .insert(source.clone(), preview.clone());
    let task = tokio::spawn({
        let runtime = runtime.clone();
        let auth = auth.clone();
        let project = project.clone();
        async move {
            runtime
                .present_image(project, "large.png".into(), Some(&auth))
                .await
        }
    });
    complete_image_metadata(
        &runtime,
        client,
        "large.png",
        image_metadata("large.png", &data, "image/png"),
    )
    .await;
    for _ in 0..2 {
        complete_artifact_chunk(&runtime, client, "large.png", &data, 0, 12, false).await;
    }
    let result = task.await.unwrap();
    assert!(result.success, "{:?}", result.error);
    assert_gallery_schema(&result);
    assert_eq!(result.output["image_document"]["bytes"], data.len());
    assert_eq!(result.output["image_document"]["sha256"], source.sha256);
    assert_eq!(
        result.output["image_document"]["preview"],
        preview.descriptor
    );
    assert!(!result.output.to_string().contains("content_base64"));
    let selection = webcodex_tool_contracts::ImagePreviewSelection {
        bytes: preview.bytes.len(),
        sha256: preview.descriptor["sha256"].as_str().unwrap().into(),
    };
    let foreign = managed_oauth_auth_context("bob", None);
    let denied = runtime
        .read_image_preview_chunk(source.clone(), selection.clone(), 0, Some(&foreign))
        .await;
    assert!(!denied.success);
    assert!(probe_patch_agent_request(&runtime, client).await.is_none());
    for stale in [false, true] {
        let task = tokio::spawn({
            let runtime = runtime.clone();
            let auth = auth.clone();
            let source = source.clone();
            let selection = selection.clone();
            async move {
                runtime
                    .read_image_preview_chunk(source, selection, 0, Some(&auth))
                    .await
            }
        });
        complete_artifact_chunk(&runtime, client, "large.png", &data, 0, 12, stale).await;
        let result = task.await.unwrap();
        assert_eq!(result.success, !stale);
        if !stale {
            assert_eq!(result.output["artifact_chunk"]["sha256"], selection.sha256);
            assert_eq!(
                result.output["artifact_chunk"]["bytes_total"],
                preview.bytes.len()
            );
        }
    }
}
