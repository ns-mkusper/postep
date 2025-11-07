use anyhow::{Context, Result};
use napi_derive::napi;
use once_cell::sync::Lazy;
use org_core::{service::AgendaSnapshot, OrgService};
use org_roam::build_roam_graph;
use org_sync::{OrgSyncService, StorageBackend, SyncRoot};
use parking_lot::RwLock;
use serde_json::json;
use std::collections::HashSet;
use std::path::PathBuf;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct OrgBridgeConfig {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
}

struct SyncState {
    service: OrgSyncService,
    doc_roots: HashSet<String>,
    roam_roots: HashSet<String>,
}

impl SyncState {
    fn new() -> Self {
        Self {
            service: OrgSyncService::new(),
            doc_roots: HashSet::new(),
            roam_roots: HashSet::new(),
        }
    }

    fn update_doc_root(&mut self, root: &str) -> Result<()> {
        if self.doc_roots.insert(root.to_string()) {
            self.service.register_root(SyncRoot {
                id: root.to_string(),
                backend: StorageBackend::Local {
                    path: PathBuf::from(root),
                },
                display_name: root.to_string(),
                org_roam: false,
            })?;
        }
        Ok(())
    }

    fn update_roam_root(&mut self, root: &str) -> Result<()> {
        if self.roam_roots.insert(root.to_string()) {
            self.service.register_root(SyncRoot {
                id: format!("roam:{}", root),
                backend: StorageBackend::Local {
                    path: PathBuf::from(root),
                },
                display_name: root.to_string(),
                org_roam: true,
            })?;
        }
        Ok(())
    }
}

static SYNC_STATE: Lazy<RwLock<SyncState>> = Lazy::new(|| RwLock::new(SyncState::new()));

fn ensure_roots_registered(doc_roots: &[String], roam_roots: &[String]) -> Result<()> {
    let mut guard = SYNC_STATE.write();
    for root in doc_roots {
        guard.update_doc_root(root)?;
    }
    for root in roam_roots {
        guard.update_roam_root(root)?;
    }

    while let Some(job) = guard.service.dequeue_job() {
        let doc_snapshot: Vec<String> = guard.doc_roots.iter().cloned().collect();
        let roam_snapshot: Vec<String> = guard.roam_roots.iter().cloned().collect();
        let _ = guard
            .service
            .perform_job(job, move |_| build_service(&doc_snapshot, &roam_snapshot));
    }

    Ok(())
}

fn extract_roam_roots(option: &Option<Vec<String>>) -> Vec<String> {
    option.clone().unwrap_or_default()
}

#[napi(object)]
pub struct CompleteAgendaParams {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub path: String,
    pub headline_line: u32,
}

#[napi(object)]
pub struct CaptureRequest {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub target_path: String,
    pub content: String,
}

#[napi(object)]
pub struct SetAgendaStatusParams {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub path: String,
    pub headline_line: u32,
    pub status: String,
}

#[napi(object)]
pub struct OrgDocumentPayload {
    pub path: String,
    pub raw: String,
    pub slate: serde_json::Value,
}

#[napi]
pub fn ping() -> String {
    "postep-org-bridge".to_owned()
}

#[napi]
pub fn load_agenda_snapshot(config: OrgBridgeConfig) -> napi::Result<serde_json::Value> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let service = build_service(&config.roots, &roam_roots).map_err(to_napi_error)?;

    let snapshot = service
        .agenda_snapshot()
        .context("failed to load agenda snapshot")
        .map_err(to_napi_error)?;

    Ok(snapshot_to_json(&snapshot))
}

#[napi]
pub fn complete_agenda_item(params: CompleteAgendaParams) -> napi::Result<serde_json::Value> {
    let CompleteAgendaParams {
        roots,
        roam_roots,
        path,
        headline_line,
    } = params;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec).map_err(to_napi_error)?;
    let service = build_service(&roots, &roam_vec).map_err(to_napi_error)?;
    service
        .complete_headline(&path, headline_line as usize)
        .map_err(to_napi_error)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")
        .map_err(to_napi_error)?;
    Ok(snapshot_to_json(&snapshot))
}

#[napi]
pub fn append_capture_entry(request: CaptureRequest) -> napi::Result<serde_json::Value> {
    let CaptureRequest {
        roots,
        roam_roots,
        target_path,
        content,
    } = request;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec).map_err(to_napi_error)?;
    let service = build_service(&roots, &roam_vec).map_err(to_napi_error)?;
    service
        .append_to_document(&target_path, &content)
        .map_err(to_napi_error)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")
        .map_err(to_napi_error)?;
    Ok(snapshot_to_json(&snapshot))
}

#[napi]
pub fn load_roam_graph(config: OrgBridgeConfig) -> napi::Result<serde_json::Value> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let service = build_service(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let graph = build_roam_graph(&service).map_err(to_napi_error)?;
    Ok(json!({
        "nodes": graph.node_data(),
        "links": graph.link_data(),
    }))
}

#[napi]
pub fn list_documents(config: OrgBridgeConfig) -> napi::Result<Vec<String>> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let service = build_service(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let docs = service.list_documents();
    Ok(docs
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[napi]
pub fn load_document(config: OrgBridgeConfig, path: String) -> napi::Result<OrgDocumentPayload> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let service = build_service(&config.roots, &roam_roots).map_err(to_napi_error)?;
    let doc = service
        .get_document(&path)
        .with_context(|| format!("document not loaded: {}", path))
        .map_err(to_napi_error)?;
    let slate = service.slate_nodes(&path).map_err(to_napi_error)?;
    let slate_json = serde_json::to_value(slate).map_err(|err| to_napi_error(err.into()))?;
    Ok(OrgDocumentPayload {
        path,
        raw: doc.raw().to_string(),
        slate: slate_json,
    })
}

#[napi]
pub fn set_roots(config: OrgBridgeConfig) -> napi::Result<()> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots).map_err(to_napi_error)?;
    Ok(())
}

#[napi]
pub fn set_agenda_status(params: SetAgendaStatusParams) -> napi::Result<serde_json::Value> {
    let SetAgendaStatusParams {
        roots,
        roam_roots,
        path,
        headline_line,
        status,
    } = params;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec).map_err(to_napi_error)?;
    let service = build_service(&roots, &roam_vec).map_err(to_napi_error)?;
    service
        .set_headline_status(&path, headline_line as usize, &status)
        .map_err(to_napi_error)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")
        .map_err(to_napi_error)?;
    Ok(snapshot_to_json(&snapshot))
}

fn build_service(roots: &[String], roam_roots: &[String]) -> Result<OrgService> {
    let mut builder = OrgService::builder();
    for root in roots {
        builder = builder.add_root(PathBuf::from(root));
    }
    for root in roam_roots {
        builder = builder.add_root(PathBuf::from(root));
    }
    builder
        .build()
        .with_context(|| format!("failed to initialize org service for {:?}", roots))
}

fn to_napi_error(err: anyhow::Error) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, err.to_string())
}

fn snapshot_to_json(snapshot: &AgendaSnapshot) -> serde_json::Value {
    json!({
        "items": snapshot.items,
        "habits": snapshot.habits,
    })
}
