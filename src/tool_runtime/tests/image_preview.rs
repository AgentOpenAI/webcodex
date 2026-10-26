use super::*;

fn source(index: usize) -> ImageSource {
    ImageSource {
        project: "agent:fixture:images".into(),
        path: format!("{index}.png"),
        bytes: 12,
        sha256: "a".repeat(64),
    }
}

fn preview(bytes: usize) -> Preview {
    Preview {
        bytes: Arc::new(vec![0; bytes]),
        descriptor: json!({"sha256":"a".repeat(64)}),
    }
}

#[test]
fn image_preview_cache_bounds_entries_bytes_ttl_and_exact_source_identity() {
    let store = ImagePreviewStore::default();
    for index in 0..40 {
        store.insert(source(index), preview(MAX_IMAGE_PREVIEW_BYTES));
    }
    let entries = store.entries.lock().unwrap();
    assert_eq!(entries.len(), 32);
    assert_eq!(
        entries.iter().map(|e| e.preview.bytes.len()).sum::<usize>(),
        64 * 1024 * 1024
    );
    drop(entries);
    assert!(store.get(&source(0)).is_none());
    assert!(store.get(&source(39)).is_some());
    let mut changed = source(39);
    changed.sha256 = "b".repeat(64);
    assert!(store.get(&changed).is_none());
    changed = source(39);
    changed.project = "agent:other:images".into();
    assert!(store.get(&changed).is_none());
    for entry in store.entries.lock().unwrap().iter_mut() {
        entry.created = Instant::now() - Duration::from_secs(1801);
    }
    assert!(store.get(&source(39)).is_none());
    assert!(store.entries.lock().unwrap().is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn image_preview_process_drains_owned_descendant_pipes_and_bounds_stderr() {
    let node = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/tool_runtime/tests/fixtures/image-preview-worker.py");
    let directory = tempfile::tempdir().unwrap();
    for mode in ["pipes", "stderr"] {
        let gate = Arc::new(Semaphore::new(1));
        let permit = gate.acquire_owned().await.unwrap();
        let start = Instant::now();
        let result = process(
            node.clone(),
            directory.path().join(mode),
            vec![1; 1024],
            Arc::new(AtomicBool::new(false)),
            permit,
        );
        assert!(start.elapsed() < Duration::from_secs(5));
        assert_eq!(result.is_ok(), mode == "pipes");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn image_preview_cancellation_keeps_the_permit_until_the_owned_worker_exits() {
    let node = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/tool_runtime/tests/fixtures/image-preview-worker.py");
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("cancel");
    let gate = Arc::new(Semaphore::new(1));
    let permit = gate.clone().acquire_owned().await.unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let task = tokio::task::spawn_blocking({
        let cancelled = cancelled.clone();
        let marker = marker.clone();
        move || process(node, marker, vec![1; 1024], cancelled, permit)
    });
    let start = Instant::now();
    while !marker.exists() {
        assert!(start.elapsed() < Duration::from_secs(3));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(gate.available_permits(), 0);
    cancelled.store(true, Ordering::Release);
    assert!(tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert_eq!(gate.available_permits(), 1);
}
