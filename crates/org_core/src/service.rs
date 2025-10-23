use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveTime, TimeZone, Utc};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::RwLock;
use walkdir::WalkDir;

use crate::{
    agenda,
    document::OrgDocument,
    habit,
    notifications::{NotificationRequest, NotificationSink},
};

pub struct OrgService {
    document_roots: Vec<PathBuf>,
    agenda_roots: Vec<PathBuf>,
    habit_roots: Vec<PathBuf>,
    documents: RwLock<HashMap<PathBuf, OrgDocument>>,
    watcher: Option<RecommendedWatcher>,
    notification_sink: Option<Box<dyn NotificationSink>>,
}

pub struct OrgServiceBuilder {
    document_roots: Vec<PathBuf>,
    agenda_roots: Vec<PathBuf>,
    habit_roots: Vec<PathBuf>,
    notification_sink: Option<Box<dyn NotificationSink>>,
}

impl OrgServiceBuilder {
    pub fn new() -> Self {
        Self {
            document_roots: Vec::new(),
            agenda_roots: Vec::new(),
            habit_roots: Vec::new(),
            notification_sink: None,
        }
    }

    pub fn add_root(self, path: impl AsRef<Path>) -> Self {
        self.add_document_root(path)
    }

    pub fn add_document_root(mut self, path: impl AsRef<Path>) -> Self {
        Self::push_unique(&mut self.document_roots, path.as_ref().to_path_buf());
        self
    }

    pub fn add_agenda_root(mut self, path: impl AsRef<Path>) -> Self {
        Self::push_unique(&mut self.agenda_roots, path.as_ref().to_path_buf());
        self
    }

    pub fn add_habit_root(mut self, path: impl AsRef<Path>) -> Self {
        Self::push_unique(&mut self.habit_roots, path.as_ref().to_path_buf());
        self
    }

    pub fn with_notification_sink(mut self, sink: Box<dyn NotificationSink>) -> Self {
        self.notification_sink = Some(sink);
        self
    }

    pub fn build(self) -> Result<OrgService> {
        let mut service = OrgService {
            document_roots: self.document_roots,
            agenda_roots: self.agenda_roots,
            habit_roots: self.habit_roots,
            documents: RwLock::new(HashMap::new()),
            watcher: None,
            notification_sink: self.notification_sink,
        };
        service.reload_all()?;
        Ok(service)
    }

    fn push_unique(vec: &mut Vec<PathBuf>, path: PathBuf) {
        if !vec.contains(&path) {
            vec.push(path);
        }
    }
}

impl OrgService {
    pub fn builder() -> OrgServiceBuilder {
        OrgServiceBuilder::new()
    }

    pub fn document_roots(&self) -> Vec<PathBuf> {
        self.document_roots.clone()
    }

    pub fn agenda_roots(&self) -> Vec<PathBuf> {
        self.agenda_roots.clone()
    }

    pub fn habit_roots(&self) -> Vec<PathBuf> {
        self.habit_roots.clone()
    }

    pub fn add_document_root(&mut self, path: PathBuf) -> Result<()> {
        if self.document_roots.contains(&path) {
            return Ok(());
        }
        self.document_roots.push(path.clone());
        {
            let mut docs = self.documents.write();
            self.ingest_root(&mut docs, &path)?;
        }
        self.watch_path(&path)?;
        Ok(())
    }

    pub fn add_agenda_root(&mut self, path: PathBuf) -> Result<()> {
        if self.agenda_roots.contains(&path) {
            return Ok(());
        }
        self.agenda_roots.push(path.clone());
        {
            let mut docs = self.documents.write();
            self.ingest_root(&mut docs, &path)?;
        }
        self.watch_path(&path)?;
        Ok(())
    }

    pub fn add_habit_root(&mut self, path: PathBuf) -> Result<()> {
        if self.habit_roots.contains(&path) {
            return Ok(());
        }
        self.habit_roots.push(path.clone());
        {
            let mut docs = self.documents.write();
            self.ingest_root(&mut docs, &path)?;
        }
        self.watch_path(&path)?;
        Ok(())
    }

    pub fn reload_all(&mut self) -> Result<()> {
        let mut docs = self.documents.write();
        docs.clear();
        for root in self.unique_roots() {
            self.ingest_root(&mut docs, &root)?;
        }
        Ok(())
    }

    pub fn list_documents(&self) -> Vec<PathBuf> {
        let docs = self.documents.read();
        let mut entries: Vec<PathBuf> = docs
            .keys()
            .filter(|path| Self::path_in_roots(path, &self.document_roots))
            .cloned()
            .collect();
        entries.sort();
        entries
    }

    pub fn get_document(&self, path: impl AsRef<Path>) -> Result<OrgDocument> {
        self.documents
            .read()
            .get(path.as_ref())
            .cloned()
            .ok_or_else(|| anyhow!("document not loaded"))
    }

    pub fn update_document(&self, path: impl AsRef<Path>, contents: String) -> Result<()> {
        let mut docs = self.documents.write();
        let path_buf = path.as_ref().to_path_buf();
        fs::write(&path_buf, &contents)?;
        let doc = docs
            .get_mut(&path_buf)
            .ok_or_else(|| anyhow!("document not loaded"))?;
        doc.replace_raw(contents.clone());
        if let Some(sink) = &self.notification_sink {
            let habits = habit::extract_habits(doc);
            for habit in habits {
                let title = format!("Habit: {}", habit.title);
                if let Some(date) = habit.scheduled {
                    let body = format!("Due on {}", date);
                    let naive_dt = date.and_time(NaiveTime::from_hms_opt(9, 0, 0).unwrap());
                    let when: DateTime<Utc> = Utc.from_utc_datetime(&naive_dt);
                    sink.schedule(NotificationRequest {
                        title,
                        body,
                        scheduled_for: when,
                    });
                }
            }
        }
        Ok(())
    }

    pub fn habits(&self) -> Result<Vec<habit::Habit>> {
        let docs_lock = self.documents.read();
        let docs: Vec<OrgDocument> = docs_lock
            .iter()
            .filter(|(path, _)| Self::path_in_roots(path, &self.habit_roots))
            .map(|(_, doc)| doc.clone())
            .collect();
        let mut habits_all = Vec::new();
        for doc in docs {
            habits_all.extend(habit::extract_habits(&doc));
        }
        Ok(habits_all)
    }

    pub fn agenda(&self) -> Result<Vec<agenda::AgendaItem>> {
        let docs_lock = self.documents.read();
        let docs: Vec<OrgDocument> = docs_lock
            .iter()
            .filter(|(path, _)| Self::path_in_roots(path, &self.agenda_roots))
            .map(|(_, doc)| doc.clone())
            .collect();
        Ok(agenda::build_agenda(&docs))
    }

    pub fn watch(&mut self) -> Result<()> {
        if self.watcher.is_some() {
            return Ok(());
        }
        let mut watcher = notify::recommended_watcher(|res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                tracing::debug!(?event, "filesystem change detected");
            }
        })?;
        for root in self.unique_roots() {
            let mode = if Self::root_is_file(&root) {
                RecursiveMode::NonRecursive
            } else {
                RecursiveMode::Recursive
            };
            watcher.watch(&root, mode)?;
        }
        self.watcher = Some(watcher);
        Ok(())
    }
}

impl OrgService {
    fn watch_path(&mut self, path: &Path) -> Result<()> {
        if let Some(watcher) = &mut self.watcher {
            let mode = if Self::root_is_file(path) {
                RecursiveMode::NonRecursive
            } else {
                RecursiveMode::Recursive
            };
            watcher.watch(path, mode)?;
        }
        Ok(())
    }

    fn unique_roots(&self) -> Vec<PathBuf> {
        let mut set: HashSet<PathBuf> = HashSet::new();
        for root in self
            .document_roots
            .iter()
            .chain(self.agenda_roots.iter())
            .chain(self.habit_roots.iter())
        {
            set.insert(root.clone());
        }
        set.into_iter().collect()
    }

    fn ingest_root(&self, docs: &mut HashMap<PathBuf, OrgDocument>, path: &Path) -> Result<()> {
        if path.is_file() || Self::root_is_file(path) {
            if Self::is_org_file(path) {
                let doc = OrgDocument::load(path)?;
                docs.insert(path.to_path_buf(), doc);
            }
            return Ok(());
        }

        if path.is_dir() {
            for entry in WalkDir::new(path) {
                let entry = entry?;
                let entry_path = entry.path();
                if entry.file_type().is_file() && Self::is_org_file(entry_path) {
                    let doc = OrgDocument::load(entry_path)?;
                    docs.insert(entry_path.to_path_buf(), doc);
                }
            }
        }
        Ok(())
    }

    fn path_in_roots(path: &Path, roots: &[PathBuf]) -> bool {
        if roots.is_empty() {
            return true;
        }
        roots
            .iter()
            .any(|root| Self::root_contains_path(root, path))
    }

    fn root_contains_path(root: &Path, path: &Path) -> bool {
        if Self::root_is_file(root) {
            path == root
        } else {
            path.starts_with(root)
        }
    }

    fn root_is_file(path: &Path) -> bool {
        Self::extension_is_org(path) || path.is_file()
    }

    fn is_org_file(path: &Path) -> bool {
        Self::extension_is_org(path)
    }

    fn extension_is_org(path: &Path) -> bool {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("org"))
            .unwrap_or(false)
    }
}
