use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgendaItem {
    pub title: String,
    pub date: Option<NaiveDate>,
    pub scheduled_time: Option<DateTime<Utc>>,
    pub context: String,
}

impl PartialEq for AgendaItem {
    fn eq(&self, other: &Self) -> bool {
        self.title == other.title
            && self.date == other.date
            && self.scheduled_time == other.scheduled_time
    }
}

impl Eq for AgendaItem {}

impl PartialOrd for AgendaItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AgendaItem {
    fn cmp(&self, other: &Self) -> Ordering {
        self.date
            .cmp(&other.date)
            .then_with(|| self.scheduled_time.cmp(&other.scheduled_time))
            .then_with(|| self.title.cmp(&other.title))
    }
}

/// Extracts a minimal agenda list using heuristics. This is a placeholder for a richer agenda engine.
pub fn build_agenda(documents: &[OrgDocument]) -> Vec<AgendaItem> {
    let mut items = Vec::new();

    for doc in documents {
        let mut current_title: Option<String> = None;
        let mut current_lines: Vec<String> = Vec::new();
        let mut current_date: Option<NaiveDate> = None;

        for line in doc.raw().lines() {
            if line.starts_with('*') {
                if let Some(title) = current_title.take() {
                    items.push(AgendaItem {
                        title,
                        date: current_date,
                        scheduled_time: None,
                        context: current_lines.join("\n"),
                    });
                }
                current_title = Some(line.trim_start_matches('*').trim().to_string());
                current_lines.clear();
                current_date = None;
                continue;
            }

            let trimmed = line.trim();
            if trimmed.starts_with("SCHEDULED:") {
                if let Some(date_str) = trimmed
                    .trim_start_matches("SCHEDULED:")
                    .trim()
                    .strip_prefix('<')
                    .and_then(|s| s.split(' ').next())
                {
                    if let Ok(date) =
                        NaiveDate::parse_from_str(date_str.trim_matches('>'), "%Y-%m-%d")
                    {
                        current_date = Some(date);
                    }
                }
            } else {
                current_lines.push(line.to_string());
            }
        }

        if let Some(title) = current_title.take() {
            items.push(AgendaItem {
                title,
                date: current_date,
                scheduled_time: None,
                context: current_lines.join("\n"),
            });
        }
    }

    items.sort();
    items
}
