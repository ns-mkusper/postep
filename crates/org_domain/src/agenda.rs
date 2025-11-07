use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, path::PathBuf};

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum AgendaKind {
    Scheduled,
    Deadline,
    Floating,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum RepeaterUnit {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Repeater {
    pub amount: u32,
    pub unit: RepeaterUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgendaItem {
    pub title: String,
    pub date: Option<NaiveDate>,
    pub time: Option<NaiveTime>,
    pub context: String,
    pub path: PathBuf,
    pub headline_line: usize,
    pub todo_keyword: Option<String>,
    pub kind: AgendaKind,
    pub timestamp_raw: Option<String>,
    pub repeater: Option<Repeater>,
}

impl PartialEq for AgendaItem {
    fn eq(&self, other: &Self) -> bool {
        self.title == other.title
            && self.date == other.date
            && self.time == other.time
            && self.path == other.path
            && self.headline_line == other.headline_line
            && self.todo_keyword == other.todo_keyword
            && self.kind == other.kind
            && self.timestamp_raw == other.timestamp_raw
            && self.repeater == other.repeater
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
            .then_with(|| self.time.cmp(&other.time))
            .then_with(|| self.kind.cmp(&other.kind))
            .then_with(|| self.title.cmp(&other.title))
            .then_with(|| self.path.cmp(&other.path))
            .then_with(|| self.headline_line.cmp(&other.headline_line))
    }
}

/// Extracts a minimal agenda list using heuristics. This is a placeholder for a richer agenda engine.
pub fn build_agenda(documents: &[(PathBuf, OrgDocument)]) -> Vec<AgendaItem> {
    let mut items = Vec::new();

    for (path, doc) in documents {
        let path = path.clone();
        let mut state = HeadingState::default();
        let mut in_drawer = false;

        for (idx, line) in doc.raw().lines().enumerate() {
            let trimmed = line.trim();

            if trimmed.eq_ignore_ascii_case(":PROPERTIES:")
                || trimmed.eq_ignore_ascii_case(":LOGBOOK:")
            {
                in_drawer = true;
                continue;
            }

            if trimmed.eq_ignore_ascii_case(":END:") && in_drawer {
                in_drawer = false;
                continue;
            }

            if line.starts_with('*') {
                state.emit(&path, &mut items);
                in_drawer = false;
                let (todo, title) = parse_headline(line);
                state.line_index = idx;
                state.todo_keyword = todo;
                state.title = Some(title);
                continue;
            }

            if in_drawer {
                continue;
            }

            if trimmed.starts_with("SCHEDULED:") {
                if let Some(info) = parse_timestamp_from_line(trimmed) {
                    state.schedule = Some(info);
                }
                continue;
            }

            if trimmed.starts_with("DEADLINE:") {
                if let Some(info) = parse_timestamp_from_line(trimmed) {
                    state.deadline = Some(info);
                }
                continue;
            }

            state.lines.push(line.to_string());
        }

        state.emit(&path, &mut items);
    }

    items.sort();
    items
}

#[derive(Debug, Clone)]
struct TimestampInfo {
    date: Option<NaiveDate>,
    time: Option<NaiveTime>,
    raw: Option<String>,
    repeater: Option<Repeater>,
}

#[derive(Debug, Default)]
struct HeadingState {
    title: Option<String>,
    todo_keyword: Option<String>,
    line_index: usize,
    lines: Vec<String>,
    schedule: Option<TimestampInfo>,
    deadline: Option<TimestampInfo>,
}

impl HeadingState {
    fn emit(&mut self, path: &PathBuf, out: &mut Vec<AgendaItem>) {
        let Some(title_owned) = self.title.take() else {
            self.reset();
            return;
        };

        let context = self
            .lines
            .iter()
            .filter(|line| !line.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let todo_keyword = self.todo_keyword.clone();
        let line_idx = self.line_index;

        let mut emitted = false;

        if let Some(info) = self.schedule.take() {
            out.push(AgendaItem {
                title: title_owned.clone(),
                date: info.date,
                time: info.time,
                context: context.clone(),
                path: path.clone(),
                headline_line: line_idx,
                todo_keyword: todo_keyword.clone(),
                kind: AgendaKind::Scheduled,
                timestamp_raw: info.raw.clone(),
                repeater: info.repeater,
            });
            emitted = true;
        }

        if let Some(info) = self.deadline.take() {
            out.push(AgendaItem {
                title: title_owned.clone(),
                date: info.date,
                time: info.time,
                context: context.clone(),
                path: path.clone(),
                headline_line: line_idx,
                todo_keyword: todo_keyword.clone(),
                kind: AgendaKind::Deadline,
                timestamp_raw: info.raw.clone(),
                repeater: info.repeater,
            });
            emitted = true;
        }

        if !emitted {
            out.push(AgendaItem {
                title: title_owned,
                date: None,
                time: None,
                context,
                path: path.clone(),
                headline_line: line_idx,
                todo_keyword,
                kind: AgendaKind::Floating,
                timestamp_raw: None,
                repeater: None,
            });
        }

        self.reset();
    }

    fn reset(&mut self) {
        self.title = None;
        self.todo_keyword = None;
        self.line_index = 0;
        self.lines.clear();
        self.schedule = None;
        self.deadline = None;
    }
}

fn parse_headline(line: &str) -> (Option<String>, String) {
    let content = line.trim_start_matches('*').trim();
    if content.is_empty() {
        return (None, String::new());
    }

    let mut parts = content.split_whitespace();
    if let Some(first) = parts.next() {
        if first.chars().all(|c| c.is_ascii_uppercase()) {
            let rest = content[first.len()..].trim_start().to_string();
            return (Some(first.to_string()), rest);
        }
    }

    (None, content.to_string())
}

fn parse_timestamp_from_line(line: &str) -> Option<TimestampInfo> {
    let (_, rest) = line.split_once(':')?;
    parse_timestamp(rest.trim())
}

fn parse_timestamp(segment: &str) -> Option<TimestampInfo> {
    let start = segment.find('<')?;
    let tail = &segment[start + 1..];
    let end = tail.find('>')?;
    let inner = &tail[..end];

    let mut parts = inner.split_whitespace();
    let date = parts
        .next()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());

    let mut time: Option<NaiveTime> = None;
    let mut repeater: Option<Repeater> = None;
    for part in parts {
        if time.is_none() {
            if let Some(parsed) = parse_time_segment(part) {
                time = Some(parsed);
                continue;
            }
        }
        if repeater.is_none() {
            if let Some(rep) = parse_repeater(part) {
                repeater = Some(rep);
                continue;
            }
        }
    }

    Some(TimestampInfo {
        date,
        time,
        raw: Some(inner.to_string()),
        repeater,
    })
}

fn parse_time_segment(segment: &str) -> Option<NaiveTime> {
    if !segment.contains(':') {
        return None;
    }
    let candidate = segment.split('-').next()?;
    NaiveTime::parse_from_str(candidate, "%H:%M").ok()
}

fn parse_repeater(segment: &str) -> Option<Repeater> {
    let mut s = segment.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(stripped) = s.strip_prefix('.') {
        s = stripped;
    }
    let plus_count = s.chars().take_while(|c| *c == '+').count();
    if plus_count == 0 {
        return None;
    }
    s = &s[plus_count..];
    if let Some(stripped) = s.strip_prefix('/') {
        // skip diary style repeater like /+1w
        s = stripped;
    }
    let digits_len = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits_len == 0 {
        return None;
    }
    let amount = s[..digits_len].parse::<u32>().ok()?;
    let unit_char = s[digits_len..].chars().next()?;
    let unit = match unit_char {
        'd' | 'D' => RepeaterUnit::Day,
        'w' | 'W' => RepeaterUnit::Week,
        'm' | 'M' => RepeaterUnit::Month,
        'y' | 'Y' => RepeaterUnit::Year,
        _ => return None,
    };
    Some(Repeater {
        amount: amount.max(1),
        unit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::OrgDocument;
    use std::path::PathBuf;

    #[test]
    fn parses_repeater_information() {
        let raw = r#"
* TODO Daily Stretch
SCHEDULED: <2025-10-24 Fri 06:30 ++1d>
"#;
        let doc = OrgDocument::from_string("repeat_test.org", raw.to_string());
        let items = build_agenda(&[(PathBuf::from("repeat_test.org"), doc)]);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.kind, AgendaKind::Scheduled);
        assert_eq!(
            item.date,
            Some(NaiveDate::from_ymd_opt(2025, 10, 24).unwrap())
        );
        let repeater = item.repeater.expect("repeater parsed");
        assert_eq!(repeater.amount, 1);
        assert_eq!(repeater.unit, RepeaterUnit::Day);
    }

    #[test]
    fn builds_agenda_with_scheduled_deadline_and_floating_items() {
        let raw = r#"
* TODO Morning Run
SCHEDULED: <2025-10-24 Fri 06:30>

* NEXT File Taxes
DEADLINE: <2025-10-25 Sat>

* Read a book
"#;
        let doc = OrgDocument::from_string("agenda_test.org", raw.to_string());
        let items = build_agenda(&[(PathBuf::from("agenda_test.org"), doc)]);
        assert_eq!(items.len(), 3);

        let scheduled = items
            .iter()
            .find(|item| item.title == "Morning Run")
            .expect("scheduled item present");
        assert_eq!(scheduled.kind, AgendaKind::Scheduled);
        assert_eq!(scheduled.todo_keyword.as_deref(), Some("TODO"));
        assert_eq!(
            scheduled.date,
            Some(NaiveDate::from_ymd_opt(2025, 10, 24).unwrap())
        );
        assert_eq!(
            scheduled.time,
            Some(NaiveTime::from_hms_opt(6, 30, 0).unwrap())
        );
        assert_eq!(
            scheduled.timestamp_raw.as_deref(),
            Some("2025-10-24 Fri 06:30")
        );

        let deadline = items
            .iter()
            .find(|item| item.title == "File Taxes")
            .expect("deadline item present");
        assert_eq!(deadline.kind, AgendaKind::Deadline);
        assert_eq!(deadline.todo_keyword.as_deref(), Some("NEXT"));
        assert_eq!(
            deadline.date,
            Some(NaiveDate::from_ymd_opt(2025, 10, 25).unwrap())
        );
        assert_eq!(deadline.time, None);

        let floating = items
            .iter()
            .find(|item| item.title == "Read a book")
            .expect("floating item present");
        assert_eq!(floating.kind, AgendaKind::Floating);
        assert!(floating.date.is_none());
        assert!(floating.todo_keyword.is_none());
    }

    #[test]
    fn ignores_drawer_content_in_context() {
        let raw = r#"
* TODO Weekly Review
:PROPERTIES:
:CUSTOM_ID: review
:END:
SCHEDULED: <2025-10-24 Fri>
Notes line that should appear.
:LOGBOOK:
- State "DONE"       from "TODO"       [2025-10-23 Thu]
:END:
"#;
        let doc = OrgDocument::from_string("drawer_test.org", raw.to_string());
        let items = build_agenda(&[(PathBuf::from("drawer_test.org"), doc)]);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert!(item.context.contains("Notes line"));
        assert!(
            !item.context.contains("CUSTOM_ID"),
            "drawer content should be omitted"
        );
        assert!(
            !item.context.contains("State \"DONE\""),
            "logbook entries should be omitted"
        );
    }
}
