use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Habit {
    pub title: String,
    pub scheduled: Option<NaiveDate>,
    pub description: String,
    pub repeater: Option<HabitRepeater>,
    pub log_entries: Vec<HabitLogEntry>,
    pub last_repeat: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HabitLogEntry {
    pub date: NaiveDate,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HabitRepeater {
    pub raw: String,
    pub frequency: Option<HabitFrequency>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum HabitFrequency {
    Daily(u32),
    Weekly(u32),
    Monthly(u32),
    Yearly(u32),
}

impl HabitRepeater {
    fn from_token(token: &str) -> Self {
        let frequency = parse_frequency(token);
        Self {
            raw: token.to_string(),
            frequency,
        }
    }
}

#[derive(Default)]
struct HabitBuilder {
    title: String,
    scheduled: Option<NaiveDate>,
    description_lines: Vec<String>,
    is_habit: bool,
    repeater: Option<HabitRepeater>,
    log_entries: Vec<HabitLogEntry>,
    last_repeat: Option<NaiveDate>,
}

impl HabitBuilder {
    fn new(title: String) -> Self {
        Self {
            title,
            ..Self::default()
        }
    }

    fn into_habit(self) -> Option<Habit> {
        if !self.is_habit {
            return None;
        }
        let description = self.description_lines.join("\n").trim().to_string();
        let last_repeat = self
            .last_repeat
            .or_else(|| self.log_entries.iter().map(|entry| entry.date).max());
        Some(Habit {
            title: self.title,
            scheduled: self.scheduled,
            description,
            repeater: self.repeater,
            log_entries: self.log_entries,
            last_repeat,
        })
    }

    fn reset_for_heading(&mut self, title: String) {
        *self = HabitBuilder::new(title);
    }
}

/// Extract org-habit headings together with repeat metadata and completion logs.
pub fn extract_habits(doc: &OrgDocument) -> Vec<Habit> {
    let mut habits = Vec::new();
    let mut builder = HabitBuilder::default();
    let mut in_drawer = false;
    let mut drawer_name: Option<String> = None;

    for line in doc.raw().lines() {
        if line.starts_with('*') {
            if let Some(habit) = std::mem::take(&mut builder).into_habit() {
                habits.push(habit);
            }
            builder.reset_for_heading(line.trim_start_matches('*').trim().to_string());
            in_drawer = false;
            drawer_name = None;
            continue;
        }

        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case(":PROPERTIES:") || trimmed.eq_ignore_ascii_case(":LOGBOOK:")
        {
            in_drawer = true;
            drawer_name = Some(trimmed.trim_matches(':').to_ascii_uppercase());
            continue;
        }
        if trimmed.eq_ignore_ascii_case(":END:") && in_drawer {
            in_drawer = false;
            drawer_name = None;
            continue;
        }

        if in_drawer {
            if let Some(name) = &drawer_name {
                match name.as_str() {
                    "PROPERTIES" => {
                        if let Some(rest) = trimmed.strip_prefix(':') {
                            if let Some((key, value)) = rest.split_once(':') {
                                let key_upper = key.trim().to_ascii_uppercase();
                                let value = value.trim();
                                if key_upper == "STYLE" && value.eq_ignore_ascii_case("habit") {
                                    builder.is_habit = true;
                                } else if key_upper == "LAST_REPEAT" {
                                    if let Some(date) = extract_date_from_brackets(value) {
                                        builder.last_repeat = Some(date);
                                    }
                                }
                            }
                        }
                    }
                    "LOGBOOK" => {
                        if let Some(entry) = parse_logbook_entry(trimmed) {
                            builder.log_entries.push(entry);
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }

        if trimmed.starts_with("SCHEDULED:") {
            if let Some(info) = parse_scheduled(trimmed) {
                builder.scheduled = Some(info.date);
                builder.repeater = info.repeater;
            }
            continue;
        }

        if !trimmed.is_empty() {
            builder.description_lines.push(line.to_string());
        }
    }

    if let Some(habit) = builder.into_habit() {
        habits.push(habit);
    }

    habits
}

struct ScheduledInfo {
    date: NaiveDate,
    repeater: Option<HabitRepeater>,
}

fn parse_scheduled(line: &str) -> Option<ScheduledInfo> {
    let rest = line.trim_start_matches("SCHEDULED:").trim();
    let bracket = rest.strip_prefix('<')?.strip_suffix('>')?;
    let mut parts = bracket.split_whitespace();
    let date_str = parts.next()?;
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let mut repeater: Option<HabitRepeater> = None;
    for part in parts {
        if part.starts_with('+') || part.starts_with('.') {
            repeater = Some(HabitRepeater::from_token(part));
            break;
        }
    }
    Some(ScheduledInfo { date, repeater })
}

fn extract_date_from_brackets(input: &str) -> Option<NaiveDate> {
    let trimmed = input.trim();
    let inner = trimmed.trim_start_matches('[').trim_end_matches(']').trim();
    let mut tokens = inner.split_whitespace();
    let date_str = tokens.next()?;
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()
}

fn parse_logbook_entry(line: &str) -> Option<HabitLogEntry> {
    if !line.starts_with('-') {
        return None;
    }
    let state = line.split('"').nth(1)?.trim().to_string();
    let date_section = line.split('[').nth(1)?.split(']').next()?;
    let date_str = date_section.split_whitespace().next()?;
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    Some(HabitLogEntry { date, state })
}

fn parse_frequency(token: &str) -> Option<HabitFrequency> {
    let normalized = token.trim_start_matches('+').trim_start_matches('.');
    if normalized.is_empty() {
        return None;
    }
    let unit = normalized.chars().last()?;
    let value_part = &normalized[..normalized.len() - 1];
    let quantity: u32 = value_part.parse().ok()?;
    match unit {
        'd' | 'D' => Some(HabitFrequency::Daily(quantity.max(1))),
        'w' | 'W' => Some(HabitFrequency::Weekly(quantity.max(1))),
        'm' | 'M' => Some(HabitFrequency::Monthly(quantity.max(1))),
        'y' | 'Y' => Some(HabitFrequency::Yearly(quantity.max(1))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::OrgDocument;

    #[test]
    fn extracts_habit_with_repeater_and_logbook() {
        let raw = r#"
* TODO Meditate
SCHEDULED: <2025-10-20 Mon +1d>
:PROPERTIES:
:STYLE: habit
:LAST_REPEAT: [2025-10-22 Wed]
:END:
:LOGBOOK:
- State "DONE"       from "TODO"       [2025-10-22 Wed]
- State "DONE"       from "TODO"       [2025-10-21 Tue]
:END:
Take a short mindful break.
"#;
        let doc = OrgDocument::from_string("habit_test.org", raw.to_string());
        let habits = extract_habits(&doc);
        assert_eq!(habits.len(), 1);
        let habit = &habits[0];
        assert_eq!(habit.title, "TODO Meditate");
        assert_eq!(
            habit.scheduled,
            Some(NaiveDate::from_ymd_opt(2025, 10, 20).unwrap())
        );
        assert_eq!(habit.log_entries.len(), 2);
        assert_eq!(
            habit.last_repeat,
            Some(NaiveDate::from_ymd_opt(2025, 10, 22).unwrap())
        );
        assert!(habit
            .repeater
            .as_ref()
            .and_then(|rep| rep.frequency.clone())
            .is_some());
        assert_eq!(habit.repeater.as_ref().unwrap().raw, "+1d");
        assert!(habit.description.contains("mindful"));
    }
}
