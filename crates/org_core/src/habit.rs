use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Habit {
    pub title: String,
    pub scheduled: Option<NaiveDate>,
    pub description: String,
}

#[derive(Default)]
struct HabitBuilder {
    title: String,
    scheduled: Option<NaiveDate>,
    description_lines: Vec<String>,
    is_habit: bool,
}

impl HabitBuilder {
    fn into_habit(self) -> Option<Habit> {
        if !self.is_habit {
            return None;
        }
        let description = self.description_lines.join("\n").trim().to_string();
        Some(Habit {
            title: self.title,
            scheduled: self.scheduled,
            description,
        })
    }
}

/// Very lightweight parser that extracts org-habit headings.
pub fn extract_habits(doc: &OrgDocument) -> Vec<Habit> {
    let mut habits = Vec::new();
    let mut builder = HabitBuilder::default();
    let mut in_properties = false;

    for line in doc.raw().lines() {
        if line.starts_with('*') {
            if let Some(habit) = std::mem::take(&mut builder).into_habit() {
                habits.push(habit);
            }
            builder = HabitBuilder {
                title: line.trim_start_matches('*').trim().to_string(),
                ..HabitBuilder::default()
            };
            in_properties = false;
            continue;
        }

        let trimmed = line.trim();
        if trimmed == ":PROPERTIES:" {
            in_properties = true;
            continue;
        }
        if trimmed == ":END:" {
            in_properties = false;
            continue;
        }

        if in_properties {
            if let Some(rest) = trimmed.strip_prefix(':') {
                if let Some((key, value)) = rest.split_once(':') {
                    let key = key.trim().to_ascii_uppercase();
                    let value = value.trim();
                    if key == "STYLE" && value.eq_ignore_ascii_case("habit") {
                        builder.is_habit = true;
                    }
                }
            }
            continue;
        }

        if trimmed.starts_with("SCHEDULED:") {
            let rest = trimmed.trim_start_matches("SCHEDULED:").trim();
            if let Some(date_str) = rest.strip_prefix('<').and_then(|s| s.split(' ').next()) {
                if let Ok(date) = NaiveDate::parse_from_str(date_str.trim_matches('>'), "%Y-%m-%d")
                {
                    builder.scheduled = Some(date);
                }
            }
            continue;
        }

        builder.description_lines.push(line.to_string());
    }

    if let Some(habit) = builder.into_habit() {
        habits.push(habit);
    }

    habits
}
