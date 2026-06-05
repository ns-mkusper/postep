use std::collections::BTreeMap;

use serde::Serialize;

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum LexicalNode {
    #[serde(rename = "heading")]
    Heading {
        depth: u32,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
        todo_keyword: Option<String>,
        priority: Option<String>,
        tags: Vec<String>,
    },
    #[serde(rename = "planning")]
    Planning {
        keyword: String,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "property_drawer")]
    PropertyDrawer {
        properties: BTreeMap<String, String>,
        raw: String,
        line_start: usize,
        line_end: usize,
        collapsed: bool,
    },
    #[serde(rename = "drawer")]
    Drawer {
        name: String,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
        collapsed: bool,
    },
    #[serde(rename = "paragraph")]
    Paragraph {
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "list_item")]
    ListItem {
        depth: u32,
        ordered: bool,
        checked: Option<bool>,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "code_block")]
    CodeBlock {
        language: Option<String>,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "table")]
    Table {
        rows: Vec<Vec<String>>,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "directive")]
    Directive {
        keyword: String,
        text: String,
        raw: String,
        line_start: usize,
        line_end: usize,
    },
    #[serde(rename = "horizontal_rule")]
    HorizontalRule {
        raw: String,
        line_start: usize,
        line_end: usize,
    },
}

#[derive(Debug, Clone)]
struct SourceLine {
    number: usize,
    text: String,
}

pub fn document_to_lexical(doc: &OrgDocument) -> Vec<LexicalNode> {
    let source: Vec<SourceLine> = doc
        .raw()
        .lines()
        .enumerate()
        .map(|(number, text)| SourceLine {
            number,
            text: text.to_string(),
        })
        .collect();

    let mut nodes: Vec<LexicalNode> = Vec::new();
    let mut idx = 0;

    while idx < source.len() {
        let line = &source[idx];
        let trimmed = line.text.trim();

        if trimmed.is_empty() {
            idx += 1;
            continue;
        }

        if let Some(node) = parse_heading(line) {
            nodes.push(node);
            idx += 1;
            continue;
        }

        if let Some(node) = parse_planning(line) {
            nodes.push(node);
            idx += 1;
            continue;
        }

        if trimmed.eq_ignore_ascii_case(":PROPERTIES:") {
            let (node, next_idx) = collect_property_drawer(&source, idx);
            nodes.push(node);
            idx = next_idx;
            continue;
        }

        if let Some(drawer_name) = drawer_name(trimmed) {
            let (node, next_idx) = collect_drawer(&source, idx, drawer_name);
            nodes.push(node);
            idx = next_idx;
            continue;
        }

        if begins_block(trimmed, "#+BEGIN_SRC") || begins_block(trimmed, "#+BEGIN_EXAMPLE") {
            let (node, next_idx) = collect_code_block(&source, idx);
            nodes.push(node);
            idx = next_idx;
            continue;
        }

        if trimmed.starts_with("#+") {
            nodes.push(parse_directive(line));
            idx += 1;
            continue;
        }

        if is_horizontal_rule(trimmed) {
            nodes.push(LexicalNode::HorizontalRule {
                raw: line.text.clone(),
                line_start: line.number,
                line_end: line.number,
            });
            idx += 1;
            continue;
        }

        if is_table_row(trimmed) {
            let (node, next_idx) = collect_table(&source, idx);
            nodes.push(node);
            idx = next_idx;
            continue;
        }

        if let Some(node) = parse_list_item(line) {
            nodes.push(node);
            idx += 1;
            continue;
        }

        let (node, next_idx) = collect_paragraph(&source, idx);
        nodes.push(node);
        idx = next_idx;
    }

    if nodes.is_empty() {
        nodes.push(LexicalNode::Paragraph {
            text: String::new(),
            raw: String::new(),
            line_start: 0,
            line_end: 0,
        });
    }

    nodes
}

fn parse_heading(line: &SourceLine) -> Option<LexicalNode> {
    let trimmed = line.text.trim_start();
    let stars_len = trimmed.chars().take_while(|c| *c == '*').count();
    if stars_len == 0
        || !trimmed
            .chars()
            .nth(stars_len)
            .is_some_and(|c| c.is_whitespace())
    {
        return None;
    }

    let content = trimmed[stars_len..].trim();
    let (content_without_tags, tags) = parse_tags(content);
    let mut parts = content_without_tags.split_whitespace().peekable();
    let mut todo_keyword = None;
    let mut priority = None;

    if let Some(first) = parts.peek().copied() {
        if is_todo_keyword(first) {
            todo_keyword = Some(first.to_string());
            parts.next();
        }
    }

    if let Some(next) = parts.peek().copied() {
        if next.starts_with("[#") && next.ends_with(']') && next.len() == 4 {
            priority = Some(next[2..3].to_string());
            parts.next();
        }
    }

    let text = parts.collect::<Vec<_>>().join(" ");

    Some(LexicalNode::Heading {
        depth: stars_len as u32,
        text,
        raw: line.text.clone(),
        line_start: line.number,
        line_end: line.number,
        todo_keyword,
        priority,
        tags,
    })
}

fn parse_planning(line: &SourceLine) -> Option<LexicalNode> {
    let trimmed = line.text.trim();
    for keyword in ["SCHEDULED:", "DEADLINE:", "CLOSED:"] {
        if let Some(rest) = trimmed.strip_prefix(keyword) {
            return Some(LexicalNode::Planning {
                keyword: keyword.trim_end_matches(':').to_string(),
                text: rest.trim().to_string(),
                raw: line.text.clone(),
                line_start: line.number,
                line_end: line.number,
            });
        }
    }
    None
}

fn collect_property_drawer(source: &[SourceLine], start: usize) -> (LexicalNode, usize) {
    let (raw_lines, end_idx) = collect_until_drawer_end(source, start);
    let mut properties = BTreeMap::new();
    for line in raw_lines.iter().skip(1) {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case(":END:") {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix(':') {
            if let Some((key, value)) = rest.split_once(':') {
                properties.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    let line_start = source[start].number;
    let line_end = source[end_idx - 1].number;
    (
        LexicalNode::PropertyDrawer {
            properties,
            raw: raw_lines.join("\n"),
            line_start,
            line_end,
            collapsed: true,
        },
        end_idx,
    )
}

fn collect_drawer(source: &[SourceLine], start: usize, name: String) -> (LexicalNode, usize) {
    let (raw_lines, end_idx) = collect_until_drawer_end(source, start);
    let text = raw_lines
        .iter()
        .skip(1)
        .take_while(|line| !line.trim().eq_ignore_ascii_case(":END:"))
        .map(|line| line.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let line_start = source[start].number;
    let line_end = source[end_idx - 1].number;
    (
        LexicalNode::Drawer {
            name,
            text,
            raw: raw_lines.join("\n"),
            line_start,
            line_end,
            collapsed: true,
        },
        end_idx,
    )
}

fn collect_until_drawer_end(source: &[SourceLine], start: usize) -> (Vec<String>, usize) {
    let mut idx = start;
    let mut raw = Vec::new();
    while idx < source.len() {
        let text = source[idx].text.clone();
        let is_end = text.trim().eq_ignore_ascii_case(":END:");
        raw.push(text);
        idx += 1;
        if is_end {
            break;
        }
    }
    (raw, idx)
}

fn collect_code_block(source: &[SourceLine], start: usize) -> (LexicalNode, usize) {
    let first = source[start].text.trim();
    let language = first
        .split_whitespace()
        .nth(1)
        .map(|lang| lang.trim().to_string())
        .filter(|lang| !lang.is_empty());
    let mut idx = start;
    let mut raw = Vec::new();
    let mut body = Vec::new();
    while idx < source.len() {
        let text = source[idx].text.clone();
        let trimmed = text.trim();
        let is_end = trimmed.eq_ignore_ascii_case("#+END_SRC")
            || trimmed.eq_ignore_ascii_case("#+END_EXAMPLE");
        if idx != start && !is_end {
            body.push(text.clone());
        }
        raw.push(text);
        idx += 1;
        if is_end {
            break;
        }
    }
    let line_start = source[start].number;
    let line_end = source[idx - 1].number;
    (
        LexicalNode::CodeBlock {
            language,
            text: body.join("\n"),
            raw: raw.join("\n"),
            line_start,
            line_end,
        },
        idx,
    )
}

fn collect_table(source: &[SourceLine], start: usize) -> (LexicalNode, usize) {
    let mut idx = start;
    let mut raw = Vec::new();
    let mut rows = Vec::new();
    while idx < source.len() && is_table_row(source[idx].text.trim()) {
        let line = source[idx].text.clone();
        rows.push(
            line.trim()
                .trim_matches('|')
                .split('|')
                .map(|cell| cell.trim().to_string())
                .collect(),
        );
        raw.push(line);
        idx += 1;
    }
    let line_start = source[start].number;
    let line_end = source[idx - 1].number;
    (
        LexicalNode::Table {
            rows,
            raw: raw.join("\n"),
            line_start,
            line_end,
        },
        idx,
    )
}

fn collect_paragraph(source: &[SourceLine], start: usize) -> (LexicalNode, usize) {
    let mut idx = start;
    let mut lines = Vec::new();
    while idx < source.len() {
        let line = &source[idx];
        let trimmed = line.text.trim();
        if trimmed.is_empty()
            || parse_heading(line).is_some()
            || parse_planning(line).is_some()
            || drawer_name(trimmed).is_some()
            || begins_block(trimmed, "#+BEGIN_SRC")
            || begins_block(trimmed, "#+BEGIN_EXAMPLE")
            || trimmed.starts_with("#+")
            || is_horizontal_rule(trimmed)
            || is_table_row(trimmed)
            || parse_list_item(line).is_some()
        {
            break;
        }
        lines.push(line.text.clone());
        idx += 1;
    }
    let line_start = source[start].number;
    let line_end = source[idx - 1].number;
    (
        LexicalNode::Paragraph {
            text: lines
                .iter()
                .map(|line| line.trim())
                .collect::<Vec<_>>()
                .join(" "),
            raw: lines.join("\n"),
            line_start,
            line_end,
        },
        idx,
    )
}

fn parse_list_item(line: &SourceLine) -> Option<LexicalNode> {
    let indent = line.text.chars().take_while(|c| c.is_whitespace()).count();
    let trimmed = line.text[indent..].trim_start();

    let (ordered, rest) = if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("+ "))
        .or_else(|| trimmed.strip_prefix("* "))
    {
        (false, rest)
    } else if let Some(idx) = trimmed.find(|c: char| c == '.' || c == ')') {
        if trimmed[..idx].chars().all(|c| c.is_ascii_digit()) {
            (true, trimmed[idx + 1..].trim_start())
        } else {
            return None;
        }
    } else {
        return None;
    };

    let (checked, text) = parse_checkbox(rest.trim());

    Some(LexicalNode::ListItem {
        depth: (indent / 2 + 1) as u32,
        ordered,
        checked,
        text: text.to_string(),
        raw: line.text.clone(),
        line_start: line.number,
        line_end: line.number,
    })
}

fn parse_checkbox(text: &str) -> (Option<bool>, &str) {
    if let Some(rest) = text.strip_prefix("[ ]") {
        return (Some(false), rest.trim_start());
    }
    if let Some(rest) = text
        .strip_prefix("[X]")
        .or_else(|| text.strip_prefix("[x]"))
    {
        return (Some(true), rest.trim_start());
    }
    (None, text)
}

fn parse_directive(line: &SourceLine) -> LexicalNode {
    let trimmed = line.text.trim();
    let after = trimmed.trim_start_matches("#+");
    let (keyword, text) = after
        .split_once(':')
        .map(|(keyword, text)| (keyword.trim().to_string(), text.trim().to_string()))
        .unwrap_or_else(|| (after.to_string(), String::new()));
    LexicalNode::Directive {
        keyword,
        text,
        raw: line.text.clone(),
        line_start: line.number,
        line_end: line.number,
    }
}

fn parse_tags(content: &str) -> (String, Vec<String>) {
    let trimmed = content.trim_end();
    let Some(last_space) = trimmed.rfind(' ') else {
        return (trimmed.to_string(), Vec::new());
    };
    let tail = &trimmed[last_space + 1..];
    if tail.len() < 3 || !tail.starts_with(':') || !tail.ends_with(':') {
        return (trimmed.to_string(), Vec::new());
    }
    let tags: Vec<String> = tail
        .trim_matches(':')
        .split(':')
        .filter(|tag| !tag.is_empty())
        .map(|tag| tag.to_string())
        .collect();
    if tags.is_empty() {
        return (trimmed.to_string(), tags);
    }
    (trimmed[..last_space].trim_end().to_string(), tags)
}

fn is_todo_keyword(token: &str) -> bool {
    token
        .chars()
        .all(|c| c.is_ascii_uppercase() || c == '-' || c == '_')
        && token.chars().any(|c| c.is_ascii_alphabetic())
}

fn drawer_name(trimmed: &str) -> Option<String> {
    if trimmed.eq_ignore_ascii_case(":END:") || !trimmed.starts_with(':') || !trimmed.ends_with(':')
    {
        return None;
    }
    let name = trimmed.trim_matches(':');
    if name.is_empty() || name.contains(char::is_whitespace) {
        return None;
    }
    Some(name.to_ascii_uppercase())
}

fn begins_block(trimmed: &str, marker: &str) -> bool {
    trimmed
        .get(..marker.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(marker))
}

fn is_table_row(trimmed: &str) -> bool {
    trimmed.starts_with('|') && trimmed.ends_with('|') && trimmed.len() >= 2
}

fn is_horizontal_rule(trimmed: &str) -> bool {
    trimmed.len() >= 5 && trimmed.chars().all(|c| c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_core_org_constructs_as_distinct_blocks() {
        let raw = r#"#+TITLE: Demo
* TODO [#A] Ship useful renderer :work:mobile:
SCHEDULED: <2026-05-21 Thu 09:00 +1d>
:PROPERTIES:
:STYLE: habit
:END:
- [ ] tighten latency
| Metric | Budget |
| Move | 8ms |
#+BEGIN_SRC rust
assert!(true);
#+END_SRC
"#;
        let doc = OrgDocument::from_string("demo.org", raw.to_string());
        let nodes = document_to_lexical(&doc);

        assert!(matches!(nodes[0], LexicalNode::Directive { .. }));
        assert!(matches!(
            &nodes[1],
            LexicalNode::Heading {
                todo_keyword: Some(keyword),
                priority: Some(priority),
                tags,
                ..
            } if keyword == "TODO" && priority == "A" && tags == &vec!["work".to_string(), "mobile".to_string()]
        ));
        assert!(nodes.iter().any(
            |node| matches!(node, LexicalNode::Planning { keyword, .. } if keyword == "SCHEDULED")
        ));
        assert!(nodes.iter().any(|node| matches!(node, LexicalNode::PropertyDrawer { properties, .. } if properties.get("STYLE").is_some_and(|v| v == "habit"))));
        assert!(nodes.iter().any(|node| matches!(
            node,
            LexicalNode::ListItem {
                checked: Some(false),
                ..
            }
        )));
        assert!(nodes
            .iter()
            .any(|node| matches!(node, LexicalNode::Table { rows, .. } if rows.len() == 2)));
        assert!(nodes.iter().any(|node| matches!(node, LexicalNode::CodeBlock { language: Some(lang), text, .. } if lang == "rust" && text.contains("assert"))));
    }
}
