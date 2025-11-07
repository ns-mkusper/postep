use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::instrument;

use org_domain::service::{AgendaSnapshot, OrgService, OrgServiceBuilder};

/// Immutable description of a directory that should be synchronised.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncRoot {
    pub id: String,
    pub backend: StorageBackend,
    pub display_name: String,
    pub org_roam: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum StorageBackend {
    Local { path: PathBuf },
    GoogleDrive(GoogleDriveBinding),
}

/// Captures OAuth credentials and Drive directory metadata required for sync loops.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleDriveBinding {
    pub drive_id: String,
    pub root_id: String,
    pub refresh_token: String,
    pub access_token: Option<String>,
    pub token_expiry_seconds: Option<i64>,
}

#[derive(Debug, Default)]
pub struct OrgSyncService {
    roots: Vec<SyncRoot>,
    pending_jobs: VecDeque<SyncJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncJob {
    pub root_id: String,
    pub job_kind: SyncJobKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncJobKind {
    InitialScan,
    DriveDelta,
    LocalWatcher,
    ConflictResolution,
}

impl OrgSyncService {
    pub fn new() -> Self {
        Self::default()
    }

    #[instrument(skip(self))]
    pub fn register_root(&mut self, root: SyncRoot) -> Result<()> {
        if self.roots.iter().any(|existing| existing.id == root.id) {
            return Ok(());
        }
        if let StorageBackend::Local { path } = &root.backend {
            anyhow::ensure!(
                path.exists(),
                "sync root `{}` does not exist",
                path.display()
            );
        }
        self.pending_jobs.push_back(SyncJob {
            root_id: root.id.clone(),
            job_kind: SyncJobKind::InitialScan,
        });
        self.roots.push(root);
        Ok(())
    }

    pub fn list_roots(&self) -> &[SyncRoot] {
        &self.roots
    }

    pub fn dequeue_job(&mut self) -> Option<SyncJob> {
        self.pending_jobs.pop_front()
    }

    pub fn schedule_drive_delta(&mut self, root_id: &str) {
        self.pending_jobs.push_back(SyncJob {
            root_id: root_id.to_string(),
            job_kind: SyncJobKind::DriveDelta,
        });
    }

    pub fn schedule_local_watch(&mut self, root_id: &str) {
        self.pending_jobs.push_back(SyncJob {
            root_id: root_id.to_string(),
            job_kind: SyncJobKind::LocalWatcher,
        });
    }

    pub fn perform_job(
        &mut self,
        job: SyncJob,
        make_service: impl FnOnce(&SyncRoot) -> Result<OrgService>,
    ) -> Result<SyncReport> {
        let root = self
            .roots
            .iter()
            .find(|candidate| candidate.id == job.root_id)
            .with_context(|| format!("unknown sync root `{}`", job.root_id))?;

        let mut service = make_service(root)?;
        match job.job_kind {
            SyncJobKind::InitialScan | SyncJobKind::LocalWatcher => {
                service.reload_all()?;
                Ok(SyncReport::reloaded(root.id.clone()))
            }
            SyncJobKind::DriveDelta => Ok(SyncReport::noop(root.id.clone())),
            SyncJobKind::ConflictResolution => Ok(SyncReport::noop(root.id.clone())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncReport {
    pub root_id: String,
    pub refreshed_at: Option<Duration>,
    pub agenda_snapshot: Option<AgendaSnapshot>,
}

impl SyncReport {
    pub fn reloaded(root_id: String) -> Self {
        Self {
            root_id,
            refreshed_at: None,
            agenda_snapshot: None,
        }
    }

    pub fn with_agenda(mut self, snapshot: AgendaSnapshot) -> Self {
        self.agenda_snapshot = Some(snapshot);
        self
    }

    pub fn noop(root_id: String) -> Self {
        Self {
            root_id,
            refreshed_at: None,
            agenda_snapshot: None,
        }
    }
}

pub fn build_org_service(root: &SyncRoot) -> Result<OrgService> {
    let mut builder = OrgServiceBuilder::new();
    match &root.backend {
        StorageBackend::Local { path } => {
            builder = builder.add_root(path);
        }
        StorageBackend::GoogleDrive(binding) => {
            tracing::debug!(drive_id = %binding.drive_id, "mounting drive root via SAF");
        }
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_root_queues_initial_scan() {
        let mut service = OrgSyncService::new();
        service
            .register_root(SyncRoot {
                id: "local".into(),
                backend: StorageBackend::Local {
                    path: PathBuf::from("./"),
                },
                display_name: "Local".into(),
                org_roam: false,
            })
            .unwrap();

        assert!(matches!(
            service.dequeue_job(),
            Some(SyncJob {
                job_kind: SyncJobKind::InitialScan,
                ..
            })
        ));
    }
}
