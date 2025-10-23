use anyhow::Result;
use chrono::{DateTime, Utc};
use orgize::Org;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Representation of an Org file on disk. Parsing is performed lazily.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgDocument {
    path: PathBuf,
    raw: String,
    #[serde(skip)]
    loaded_at: DateTime<Utc>,
}

impl OrgDocument {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let raw = fs::read_to_string(&path)?;
        Ok(Self {
            path,
            raw,
            loaded_at: Utc::now(),
        })
    }

    pub fn from_string(path: impl AsRef<Path>, raw: String) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            raw,
            loaded_at: Utc::now(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn raw(&self) -> &str {
        &self.raw
    }

    pub fn loaded_at(&self) -> DateTime<Utc> {
        self.loaded_at
    }

    pub fn parsed(&self) -> Org<'_> {
        Org::parse(&self.raw)
    }

    pub fn replace_raw(&mut self, new_raw: String) {
        self.raw = new_raw;
        self.loaded_at = Utc::now();
    }
}
