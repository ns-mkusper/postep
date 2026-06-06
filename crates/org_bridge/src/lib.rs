use anyhow::{Context, Result};
use napi::{bindgen_prelude::AsyncTask, Env, JsUnknown, Task};
use napi_derive::napi;
use once_cell::sync::Lazy;
use org_core::{service::AgendaSnapshot, OrgService};
use org_roam::build_roam_graph;
use org_sync::{OrgSyncService, StorageBackend, SyncRoot};
use parking_lot::RwLock;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

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
static SERVICE_CACHE: Lazy<RwLock<HashMap<ServiceKey, Arc<OrgService>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct ServiceKey {
    roots: Vec<String>,
    roam_roots: Vec<String>,
}

impl ServiceKey {
    fn new(roots: &[String], roam_roots: &[String]) -> Self {
        let mut roots = roots.to_vec();
        let mut roam_roots = roam_roots.to_vec();
        roots.sort();
        roots.dedup();
        roam_roots.sort();
        roam_roots.dedup();
        Self { roots, roam_roots }
    }
}

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
        invalidate_service_cache(&doc_snapshot, &roam_snapshot);
        let _ = guard
            .service
            .perform_job(job, move |_| build_fresh_service(&doc_snapshot, &roam_snapshot));
    }

    Ok(())
}

fn extract_roam_roots(option: &Option<Vec<String>>) -> Vec<String> {
    option.clone().unwrap_or_default()
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CompleteAgendaParams {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub path: String,
    pub headline_line: u32,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CaptureRequest {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub target_path: String,
    pub content: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SetAgendaStatusParams {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub path: String,
    pub headline_line: u32,
    pub status: String,
}

#[napi(object)]
#[derive(Clone, Debug, serde::Serialize)]
pub struct OrgDocumentPayload {
    pub path: String,
    pub raw: String,
    pub lexical: serde_json::Value,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UpdateDocumentParams {
    pub roots: Vec<String>,
    pub roam_roots: Option<Vec<String>>,
    pub path: String,
    pub raw: String,
}

#[napi]
pub fn ping() -> String {
    "postep-org-bridge".to_owned()
}

#[napi]
pub fn load_agenda_snapshot(config: OrgBridgeConfig) -> napi::Result<serde_json::Value> {
    load_agenda_snapshot_impl(config).map_err(to_napi_error)
}

#[napi]
pub fn load_agenda_snapshot_async(config: OrgBridgeConfig) -> AsyncTask<LoadAgendaSnapshotTask> {
    AsyncTask::new(LoadAgendaSnapshotTask { config })
}

#[napi]
pub fn complete_agenda_item(params: CompleteAgendaParams) -> napi::Result<serde_json::Value> {
    complete_agenda_item_impl(params).map_err(to_napi_error)
}

#[napi]
pub fn complete_agenda_item_async(params: CompleteAgendaParams) -> AsyncTask<CompleteAgendaItemTask> {
    AsyncTask::new(CompleteAgendaItemTask { params })
}

#[napi]
pub fn append_capture_entry(request: CaptureRequest) -> napi::Result<serde_json::Value> {
    append_capture_entry_impl(request).map_err(to_napi_error)
}

#[napi]
pub fn append_capture_entry_async(request: CaptureRequest) -> AsyncTask<AppendCaptureEntryTask> {
    AsyncTask::new(AppendCaptureEntryTask { request })
}

#[napi]
pub fn load_roam_graph(config: OrgBridgeConfig) -> napi::Result<serde_json::Value> {
    load_roam_graph_impl(config).map_err(to_napi_error)
}

#[napi]
pub fn load_roam_graph_async(config: OrgBridgeConfig) -> AsyncTask<LoadRoamGraphTask> {
    AsyncTask::new(LoadRoamGraphTask { config })
}

#[napi]
pub fn list_documents(config: OrgBridgeConfig) -> napi::Result<Vec<String>> {
    list_documents_impl(config).map_err(to_napi_error)
}

#[napi]
pub fn list_documents_async(config: OrgBridgeConfig) -> AsyncTask<ListDocumentsTask> {
    AsyncTask::new(ListDocumentsTask { config })
}

#[napi]
pub fn load_document(config: OrgBridgeConfig, path: String) -> napi::Result<OrgDocumentPayload> {
    load_document_impl(config, path).map_err(to_napi_error)
}

#[napi]
pub fn load_document_async(config: OrgBridgeConfig, path: String) -> AsyncTask<LoadDocumentTask> {
    AsyncTask::new(LoadDocumentTask { config, path })
}

#[napi]
pub fn update_document(params: UpdateDocumentParams) -> napi::Result<OrgDocumentPayload> {
    update_document_impl(params).map_err(to_napi_error)
}

#[napi]
pub fn update_document_async(params: UpdateDocumentParams) -> AsyncTask<UpdateDocumentTask> {
    AsyncTask::new(UpdateDocumentTask { params })
}

#[napi]
pub fn set_roots(config: OrgBridgeConfig) -> napi::Result<()> {
    set_roots_impl(config).map_err(to_napi_error)
}

#[napi]
pub fn set_roots_async(config: OrgBridgeConfig) -> AsyncTask<SetRootsTask> {
    AsyncTask::new(SetRootsTask { config })
}

#[napi]
pub fn set_agenda_status(params: SetAgendaStatusParams) -> napi::Result<serde_json::Value> {
    set_agenda_status_impl(params).map_err(to_napi_error)
}

#[napi]
pub fn set_agenda_status_async(params: SetAgendaStatusParams) -> AsyncTask<SetAgendaStatusTask> {
    AsyncTask::new(SetAgendaStatusTask { params })
}

pub struct LoadAgendaSnapshotTask {
    config: OrgBridgeConfig,
}

impl Task for LoadAgendaSnapshotTask {
    type Output = serde_json::Value;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        load_agenda_snapshot_impl(self.config.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

pub struct CompleteAgendaItemTask {
    params: CompleteAgendaParams,
}

impl Task for CompleteAgendaItemTask {
    type Output = serde_json::Value;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        complete_agenda_item_impl(self.params.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

pub struct AppendCaptureEntryTask {
    request: CaptureRequest,
}

impl Task for AppendCaptureEntryTask {
    type Output = serde_json::Value;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        append_capture_entry_impl(self.request.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

pub struct LoadRoamGraphTask {
    config: OrgBridgeConfig,
}

impl Task for LoadRoamGraphTask {
    type Output = serde_json::Value;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        load_roam_graph_impl(self.config.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

pub struct ListDocumentsTask {
    config: OrgBridgeConfig,
}

impl Task for ListDocumentsTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        list_documents_impl(self.config.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct LoadDocumentTask {
    config: OrgBridgeConfig,
    path: String,
}

impl Task for LoadDocumentTask {
    type Output = OrgDocumentPayload;
    type JsValue = OrgDocumentPayload;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        load_document_impl(self.config.clone(), self.path.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct UpdateDocumentTask {
    params: UpdateDocumentParams,
}

impl Task for UpdateDocumentTask {
    type Output = OrgDocumentPayload;
    type JsValue = OrgDocumentPayload;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        update_document_impl(self.params.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct SetRootsTask {
    config: OrgBridgeConfig,
}

impl Task for SetRootsTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        set_roots_impl(self.config.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

pub struct SetAgendaStatusTask {
    params: SetAgendaStatusParams,
}

impl Task for SetAgendaStatusTask {
    type Output = serde_json::Value;
    type JsValue = JsUnknown;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        set_agenda_status_impl(self.params.clone()).map_err(to_napi_error)
    }

    fn resolve(&mut self, env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

fn load_agenda_snapshot_impl(config: OrgBridgeConfig) -> Result<serde_json::Value> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots)?;
    let service = build_service(&config.roots, &roam_roots)?;

    let snapshot = service
        .agenda_snapshot()
        .context("failed to load agenda snapshot")?;

    Ok(snapshot_to_json(&snapshot))
}

fn complete_agenda_item_impl(params: CompleteAgendaParams) -> Result<serde_json::Value> {
    let CompleteAgendaParams {
        roots,
        roam_roots,
        path,
        headline_line,
    } = params;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec)?;
    let service = build_service(&roots, &roam_vec)?;
    service.complete_headline(&path, headline_line as usize)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")?;
    Ok(snapshot_to_json(&snapshot))
}

fn append_capture_entry_impl(request: CaptureRequest) -> Result<serde_json::Value> {
    let CaptureRequest {
        roots,
        roam_roots,
        target_path,
        content,
    } = request;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec)?;
    let service = build_service(&roots, &roam_vec)?;
    service.append_to_document(&target_path, &content)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")?;
    Ok(snapshot_to_json(&snapshot))
}

fn load_roam_graph_impl(config: OrgBridgeConfig) -> Result<serde_json::Value> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots)?;
    let service = build_service(&config.roots, &roam_roots)?;
    let graph = build_roam_graph(&service)?;
    Ok(json!({
        "nodes": graph.node_data(),
        "links": graph.link_data(),
    }))
}

fn list_documents_impl(config: OrgBridgeConfig) -> Result<Vec<String>> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots)?;
    let service = build_service(&config.roots, &roam_roots)?;
    let docs = service.list_documents();
    Ok(docs
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

fn load_document_impl(config: OrgBridgeConfig, path: String) -> Result<OrgDocumentPayload> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots)?;
    let service = build_service(&config.roots, &roam_roots)?;
    let doc = service
        .get_document(&path)
        .with_context(|| format!("document not loaded: {}", path))?;
    let lexical = service.lexical_nodes(&path)?;
    let lexical_json = serde_json::to_value(lexical)?;
    Ok(OrgDocumentPayload {
        path,
        raw: doc.raw().to_string(),
        lexical: lexical_json,
    })
}

fn update_document_impl(params: UpdateDocumentParams) -> Result<OrgDocumentPayload> {
    let UpdateDocumentParams {
        roots,
        roam_roots,
        path,
        raw,
    } = params;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec)?;
    let service = build_service(&roots, &roam_vec)?;
    service
        .update_document(&path, raw)
        .with_context(|| format!("failed to update document: {}", path))?;
    let doc = service
        .get_document(&path)
        .with_context(|| format!("document not loaded after update: {}", path))?;
    let lexical = service.lexical_nodes(&path)?;
    let lexical_json = serde_json::to_value(lexical)?;
    Ok(OrgDocumentPayload {
        path,
        raw: doc.raw().to_string(),
        lexical: lexical_json,
    })
}

fn set_roots_impl(config: OrgBridgeConfig) -> Result<()> {
    let roam_roots = extract_roam_roots(&config.roam_roots);
    ensure_roots_registered(&config.roots, &roam_roots)?;
    let _ = build_service(&config.roots, &roam_roots)?;
    Ok(())
}

fn set_agenda_status_impl(params: SetAgendaStatusParams) -> Result<serde_json::Value> {
    let SetAgendaStatusParams {
        roots,
        roam_roots,
        path,
        headline_line,
        status,
    } = params;
    let roam_vec = roam_roots.clone().unwrap_or_default();
    ensure_roots_registered(&roots, &roam_vec)?;
    let service = build_service(&roots, &roam_vec)?;
    service.set_headline_status(&path, headline_line as usize, &status)?;
    let snapshot = service
        .agenda_snapshot()
        .context("failed to refresh agenda snapshot")?;
    Ok(snapshot_to_json(&snapshot))
}

fn build_service(roots: &[String], roam_roots: &[String]) -> Result<Arc<OrgService>> {
    let key = ServiceKey::new(roots, roam_roots);
    if let Some(service) = SERVICE_CACHE.read().get(&key) {
        return Ok(Arc::clone(service));
    }

    let service = Arc::new(build_fresh_service(&key.roots, &key.roam_roots)?);
    let mut cache = SERVICE_CACHE.write();
    Ok(Arc::clone(cache.entry(key).or_insert(service)))
}

fn build_fresh_service(roots: &[String], roam_roots: &[String]) -> Result<OrgService> {
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

fn invalidate_service_cache(roots: &[String], roam_roots: &[String]) {
    let key = ServiceKey::new(roots, roam_roots);
    SERVICE_CACHE.write().remove(&key);
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
