use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::{
    agenda,
    document::OrgDocument,
    habit,
    notifications::{NotificationRequest, NotificationSink},
    slate,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgendaSnapshot {
    pub items: Vec<agenda::AgendaItem>,
    pub habits: Vec<habit::Habit>,
}

pub struct OrgService {
    roots: Vec<PathBuf>,
    documents: RwLock<HashMap<PathBuf, OrgDocument>>,
    watcher: Option<RecommendedWatcher>,
    notification_sink: Option<Box<dyn NotificationSink>>,
}

pub struct OrgServiceBuilder {
    roots: Vec<PathBuf>,
    notification_sink: Option<Box<dyn NotificationSink>>,
}

impl OrgServiceBuilder {
    pub fn new() -> Self {
        Self {
            roots: Vec::new(),
            notification_sink: None,
        }
    }

    pub fn add_root(self, path: impl AsRef<Path>) -> Self {
        self.add_document_root(path)
    }

    pub fn add_document_root(mut self, path: impl AsRef<Path>) -> Self {
        Self::push_unique(&mut self.roots, path.as_ref().to_path_buf());
        self
    }

    pub fn with_notification_sink(mut self, sink: Box<dyn NotificationSink>) -> Self {
        self.notification_sink = Some(sink);
        self
    }

    pub fn build(self) -> Result<OrgService> {
        let mut service = OrgService {
            roots: self.roots,
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

    pub fn roots(&self) -> Vec<PathBuf> {
        let mut roots = self.roots.clone();
        roots.sort();
        roots
    }

    pub fn add_document_root(&mut self, path: PathBuf) -> Result<()> {
        if self.roots.contains(&path) {
            return Ok(());
        }
        self.roots.push(path.clone());
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
            .filter(|path| Self::path_in_roots(path, &self.roots))
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
            .filter(|(path, _)| Self::path_in_roots(path, &self.roots))
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
        let docs: Vec<(PathBuf, OrgDocument)> = docs_lock
            .iter()
            .filter(|(path, _)| Self::path_in_roots(path, &self.roots))
            .map(|(path, doc)| (path.clone(), doc.clone()))
            .collect();
        Ok(agenda::build_agenda(&docs))
    }

    pub fn complete_agenda_item(&self, item: &agenda::AgendaItem) -> Result<()> {
        let doc = self.get_document(&item.path)?;
        let mut lines: Vec<String> = doc.raw().lines().map(|l| l.to_string()).collect();
        let idx = item.headline_line;
        let line = lines
            .get_mut(idx)
            .ok_or_else(|| anyhow!("unable to locate agenda headline"))?;

        let trimmed = line.trim_start_matches('*');
        let leading_len = line.len() - trimmed.len();
        let prefix = &line[..leading_len];
        let rest = trimmed.trim_start();

        let mut new_rest = if rest.starts_with("DONE") {
            rest.to_string()
        } else if rest.starts_with("TODO") {
            rest.replacen("TODO", "DONE", 1)
        } else if let Some(keyword) = &item.todo_keyword {
            rest.replacen(keyword, "DONE", 1)
        } else {
            format!("DONE {}", rest)
        };

        if !new_rest.starts_with("DONE") {
            new_rest = format!("DONE {}", new_rest.trim_start());
        }

        *line = format!("{}{}", prefix, new_rest);
        let new_contents = lines.join(
            "
",
        );
        self.update_document(&item.path, new_contents)?;
        Ok(())
    }

    pub fn complete_headline(&self, path: impl AsRef<Path>, headline_line: usize) -> Result<()> {
        let target = path.as_ref().to_path_buf();
        let agenda_items = self.agenda()?;
        let Some(item) = agenda_items
            .into_iter()
            .find(|candidate| candidate.path == target && candidate.headline_line == headline_line)
        else {
            return Err(anyhow!(
                "unable to locate agenda headline at {}:{}",
                target.display(),
                headline_line
            ));
        };
        self.complete_agenda_item(&item)
    }

    pub fn agenda_snapshot(&self) -> Result<AgendaSnapshot> {
        Ok(AgendaSnapshot {
            items: self.agenda()?,
            habits: self.habits()?,
        })
    }

    pub fn append_to_document(&self, path: impl AsRef<Path>, content: &str) -> Result<()> {
        let path_buf = path.as_ref().to_path_buf();
        if let Some(parent) = path_buf.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path_buf)?;
        let mut payload = content.to_string();
        if !payload.ends_with('\n') {
            payload.push('\n');
        }
        file.write_all(payload.as_bytes())?;

        let refreshed = OrgDocument::load(&path_buf)?;
        let mut docs = self.documents.write();
        docs.insert(path_buf, refreshed);
        Ok(())
    }

    pub fn set_headline_status(
        &self,
        path: impl AsRef<Path>,
        headline_line: usize,
        status: &str,
    ) -> Result<()> {
        let doc = self.get_document(&path)?;
        let mut lines: Vec<String> = doc.raw().lines().map(|l| l.to_string()).collect();
        let line = lines
            .get_mut(headline_line)
            .ok_or_else(|| anyhow!("unable to locate headline"))?;

        let trimmed = line.trim_start_matches('*');
        let leading_len = line.len() - trimmed.len();
        let prefix = &line[..leading_len];
        let rest = trimmed.trim_start();

        let mut parts = rest.splitn(2, ' ');
        let first = parts.next().unwrap_or("");
        let remainder = parts.next().unwrap_or("");
        let new_rest = if first.eq_ignore_ascii_case(status) {
            rest.to_string()
        } else {
            let tail = remainder.trim_start();
            if tail.is_empty() {
                status.trim().to_string()
            } else {
                format!("{} {}", status.trim(), tail)
            }
        };

        *line = format!("{}{}", prefix, new_rest);
        let new_contents = lines.join("\n");
        self.update_document(path, new_contents)?;
        Ok(())
    }

    pub fn slate_nodes(&self, path: impl AsRef<Path>) -> Result<Vec<slate::SlateNode>> {
        let doc = self.get_document(path)?;
        Ok(slate::document_to_slate(&doc))
    }

    pub fn add_agenda_entry(
        &self,
        target: impl AsRef<Path>,
        title: &str,
        date: NaiveDate,
    ) -> Result<()> {
        let target_path = target.as_ref();
        let doc = self.get_document(target_path)?;
        let mut contents = doc.raw().to_string();
        if !contents.is_empty() && !contents.ends_with('\n') {
            contents.push('\n');
        }
        contents.push_str(&format!(
            "* TODO {}\nSCHEDULED: <{}>\n\n",
            title,
            date.format("%Y-%m-%d")
        ));
        self.update_document(target_path, contents)
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
        self.roots.clone()
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
