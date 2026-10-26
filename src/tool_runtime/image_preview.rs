//! Non-authoritative derived bytes. Every use rechecks the exact source version.
use super::{ToolResult, ToolRuntime};
use crate::auth::AuthContext;
use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use webcodex_core::artifact_policy::{MAX_IMAGE_PREVIEW_BYTES, MAX_IMAGE_SOURCE_BYTES};
use webcodex_process::ManagedChild;
use webcodex_tool_contracts::ImagePreviewSelection;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ImageSource {
    pub project: String,
    pub path: String,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Clone)]
pub(super) struct Preview {
    pub bytes: Arc<Vec<u8>>,
    pub descriptor: Value,
}

struct Entry {
    source: ImageSource,
    preview: Preview,
    created: Instant,
}

pub(super) struct ImagePreviewStore {
    entries: Mutex<VecDeque<Entry>>,
    pub gate: Arc<Semaphore>,
    processor: Option<(PathBuf, PathBuf)>,
    #[cfg(test)]
    pub(super) wait_started: tokio::sync::Notify,
}

impl Default for ImagePreviewStore {
    fn default() -> Self {
        let processor = std::env::var_os("WEBCODEX_IMAGE_PREVIEW_NODE")
            .zip(std::env::var_os("WEBCODEX_IMAGE_PREVIEW_SHARP_PACKAGE"))
            .map(|(node, package)| (PathBuf::from(node), PathBuf::from(package)))
            .filter(|(node, package)| node.is_absolute() && package.is_absolute());
        Self {
            entries: Mutex::default(),
            gate: Arc::new(Semaphore::new(1)),
            processor,
            #[cfg(test)]
            wait_started: tokio::sync::Notify::new(),
        }
    }
}

impl ImagePreviewStore {
    fn get(&self, source: &ImageSource) -> Option<Preview> {
        let mut entries = self.entries.lock().expect("image preview cache poisoned");
        entries.retain(|e| e.created.elapsed() < Duration::from_secs(1800));
        let index = entries.iter().position(|e| &e.source == source)?;
        let entry = entries.remove(index)?;
        let result = entry.preview.clone();
        entries.push_back(entry);
        Some(result)
    }

    pub(super) fn insert(&self, source: ImageSource, preview: Preview) {
        if preview.bytes.len() > MAX_IMAGE_PREVIEW_BYTES {
            return;
        }
        let mut entries = self.entries.lock().expect("image preview cache poisoned");
        entries.retain(|e| e.source != source && e.created.elapsed() < Duration::from_secs(1800));
        while entries.len() >= 32
            || entries.iter().map(|e| e.preview.bytes.len()).sum::<usize>() + preview.bytes.len()
                > 64 * 1024 * 1024
        {
            entries.pop_front();
        }
        entries.push_back(Entry {
            source,
            preview,
            created: Instant::now(),
        });
    }
}

struct Cancel(Arc<AtomicBool>);
impl Drop for Cancel {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

fn drain(mut reader: impl Read, max: usize, overflow: &AtomicBool) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            return Ok(retained);
        }
        let remaining = max.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..n.min(remaining)]);
        if n > remaining {
            overflow.store(true, Ordering::Release);
        }
    }
}

fn process(
    node: PathBuf,
    package: PathBuf,
    input: Vec<u8>,
    cancelled: Arc<AtomicBool>,
    _permit: OwnedSemaphorePermit,
) -> Result<Preview, String> {
    let mut command = Command::new(node);
    command
        .args([
            "--max-old-space-size=192",
            "-e",
            include_str!("image_preview.cjs"),
        ])
        .arg(package)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("VIPS_CONCURRENCY", "1")
        .env("MALLOC_ARENA_MAX", "2")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child =
        ManagedChild::spawn(&mut command).map_err(|_| "Image preview processor unavailable")?;
    let stdin = child
        .child_mut()
        .stdin
        .take()
        .ok_or("Preview stdin unavailable")?;
    let stdout = child
        .child_mut()
        .stdout
        .take()
        .ok_or("Preview stdout unavailable")?;
    let stderr = child
        .child_mut()
        .stderr
        .take()
        .ok_or("Preview stderr unavailable")?;
    let overflow = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        let writer = scope.spawn(move || {
            let mut stdin = stdin;
            stdin.write_all(&input)
        });
        let output = scope.spawn(|| drain(stdout, MAX_IMAGE_PREVIEW_BYTES + 512, &overflow));
        let errors = scope.spawn(|| drain(stderr, 4096, &overflow));
        let started = Instant::now();
        let mut success = false;
        loop {
            if cancelled.load(Ordering::Acquire)
                || overflow.load(Ordering::Acquire)
                || started.elapsed() >= Duration::from_secs(30)
            {
                break;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    success = status.success();
                    break;
                }
                Ok(None) => {}
                Err(_) => break,
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        // Kill descendants as well, including a pipe-holding child after parent exit.
        let _ = child.terminate_tree();
        let _ = child.wait();
        let written = writer.join().map_err(|_| "Preview input failed")?;
        let output = output
            .join()
            .map_err(|_| "Preview output failed")?
            .map_err(|_| "Preview output failed")?;
        let _ = errors
            .join()
            .map_err(|_| "Preview diagnostics failed")?
            .map_err(|_| "Preview diagnostics failed")?;
        if !success || written.is_err() || overflow.load(Ordering::Acquire) {
            return Err("Image preview processing failed".to_string());
        }
        Ok(output)
    })?;
    let boundary = result
        .iter()
        .take(512)
        .position(|b| *b == b'\n')
        .ok_or("Invalid preview header")?;
    let header: Value =
        serde_json::from_slice(&result[..boundary]).map_err(|_| "Invalid preview metadata")?;
    let bytes = result[boundary + 1..].to_vec();
    let width = header["width"]
        .as_u64()
        .ok_or("Invalid preview dimensions")?;
    let height = header["height"]
        .as_u64()
        .ok_or("Invalid preview dimensions")?;
    if !(1..=2048).contains(&width)
        || !(1..=2048).contains(&height)
        || !(12..=MAX_IMAGE_PREVIEW_BYTES).contains(&bytes.len())
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
    {
        return Err("Invalid preview output".into());
    }
    let descriptor = json!({"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes)),"mime_type":"image/webp","width":width,"height":height,"static_frame":header["static_frame"].as_bool().unwrap_or(false)});
    Ok(Preview {
        bytes: Arc::new(bytes),
        descriptor,
    })
}

impl ToolRuntime {
    pub(super) async fn image_preview(
        &self,
        source: ImageSource,
        auth: Option<&AuthContext>,
    ) -> Result<Preview, String> {
        tokio::time::timeout(
            Duration::from_secs(90),
            self.image_preview_inner(source, auth),
        )
        .await
        .map_err(|_| "Image preview preparation timed out".to_string())?
    }

    async fn image_preview_inner(
        &self,
        source: ImageSource,
        auth: Option<&AuthContext>,
    ) -> Result<Preview, String> {
        if !(12..=MAX_IMAGE_SOURCE_BYTES).contains(&source.bytes) {
            return Err("Image source exceeds 64 MiB".into());
        }
        // Even cache hits must reauthorize and reject a changed/deleted source.
        let check = self
            .read_project_artifact_export_chunk_internal(
                &source.project,
                &source.path,
                source.bytes,
                &source.sha256,
                0,
                12,
                auth,
            )
            .await?;
        super::pdf_document::validate_app_artifact_segment(
            &check,
            &source.path,
            source.bytes,
            0,
            12,
        )
        .map_err(|_| "Image source changed or is unavailable".to_string())?;
        let store = &self.presentation.image_previews;
        if let Some(preview) = store.get(&source) {
            return Ok(preview);
        }
        #[cfg(test)]
        store.wait_started.notify_one();
        let permit =
            tokio::time::timeout(Duration::from_secs(35), store.gate.clone().acquire_owned())
                .await
                .map_err(|_| "Image preview processor busy")?
                .map_err(|_| "Image preview processor unavailable")?;
        // Waiting is not a freshness lease: another request may have populated
        // the cache while the source/Project changed during the wait.
        let check = self
            .read_project_artifact_export_chunk_internal(
                &source.project,
                &source.path,
                source.bytes,
                &source.sha256,
                0,
                12,
                auth,
            )
            .await?;
        super::pdf_document::validate_app_artifact_segment(
            &check,
            &source.path,
            source.bytes,
            0,
            12,
        )
        .map_err(|_| "Image source changed or is unavailable".to_string())?;
        if let Some(preview) = store.get(&source) {
            return Ok(preview);
        }
        let (node, package) = store
            .processor
            .clone()
            .ok_or("Image preview processor not configured")?;
        let mut data = Vec::with_capacity(source.bytes);
        while data.len() < source.bytes {
            let length = (1024 * 1024).min(source.bytes - data.len());
            let output = self
                .read_project_artifact_export_chunk_internal(
                    &source.project,
                    &source.path,
                    source.bytes,
                    &source.sha256,
                    data.len(),
                    length,
                    auth,
                )
                .await?;
            super::pdf_document::validate_app_artifact_segment(
                &output,
                &source.path,
                source.bytes,
                data.len(),
                length,
            )
            .map_err(|_| "Image source changed or is unavailable".to_string())?;
            let decoded = output["content_base64"]
                .as_str()
                .and_then(|value| general_purpose::STANDARD.decode(value).ok())
                .ok_or("Image source chunk unavailable")?;
            if decoded.len() != length
                || output["path"] != source.path
                || output["offset"] != data.len()
                || output["file_bytes"] != source.bytes
            {
                return Err("Invalid image source chunk".into());
            }
            data.extend_from_slice(&decoded);
        }
        if format!("{:x}", Sha256::digest(&data)) != source.sha256 {
            return Err("Image source changed".into());
        }
        let cancel = Cancel(Arc::new(AtomicBool::new(false)));
        let cancelled = cancel.0.clone();
        let preview =
            tokio::task::spawn_blocking(move || process(node, package, data, cancelled, permit))
                .await
                .map_err(|_| "Image preview processor failed")??;
        store.insert(source, preview.clone());
        Ok(preview)
    }

    pub(super) async fn read_image_preview_chunk(
        &self,
        source: ImageSource,
        selection: ImagePreviewSelection,
        offset: usize,
        auth: Option<&AuthContext>,
    ) -> ToolResult {
        if super::pdf_document::validate_app_artifact_target(
            &source.path,
            source.bytes,
            &source.sha256,
            0,
        )
        .is_err()
            || !(12..=MAX_IMAGE_PREVIEW_BYTES).contains(&selection.bytes)
            || offset >= selection.bytes
            || selection.sha256.len() != 64
            || !selection
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return super::image_document::image_error(
                "invalid_artifact_identity",
                "Invalid image preview identity",
            );
        }
        let resolved = match self
            .resolve_project_input_for_auth(&source.project, auth)
            .await
        {
            Ok(value) => value,
            Err(error) => return error.into_tool_result(),
        };
        let source = ImageSource {
            project: resolved.resolved_id,
            ..source
        };
        let preview = match self.image_preview(source.clone(),auth).await { Ok(value)=>value, Err(_)=>return super::image_document::image_error("image_preview_unavailable","Image source changed, was deleted, or preview could not be regenerated; explicitly reopen") };
        if preview.bytes.len() != selection.bytes
            || preview.descriptor["sha256"] != selection.sha256
        {
            return super::image_document::image_error(
                "snapshot_changed",
                "Preview version changed; explicitly reopen",
            );
        }
        let end = (offset + super::pdf_document::APP_ARTIFACT_CHUNK_BYTES).min(selection.bytes);
        ToolResult::ok(
            json!({"artifact_chunk":{"project":source.project,"path":source.path,"sha256":selection.sha256,"bytes_total":selection.bytes,"byte_offset":offset,"next_byte_offset":if end==selection.bytes {None}else{Some(end)},"complete":end==selection.bytes,"content_base64":general_purpose::STANDARD.encode(&preview.bytes[offset..end])}}),
        )
    }
}

#[cfg(test)]
#[path = "tests/image_preview.rs"]
mod tests;
