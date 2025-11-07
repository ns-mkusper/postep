use serde::Serialize;

use crate::document::OrgDocument;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SlateNode {
    #[serde(rename = "heading")]
    Heading { depth: u32, text: String },
    #[serde(rename = "paragraph")]
    Paragraph { text: String },
    #[serde(rename = "list_item")]
    ListItem {
        depth: u32,
        ordered: bool,
        text: String,
    },
}

pub fn document_to_slate(doc: &OrgDocument) -> Vec<SlateNode> {
    let mut nodes: Vec<SlateNode> = Vec::new();
    let mut paragraph_buffer: Vec<String> = Vec::new();
    let mut in_drawer = false;

    let flush_paragraph = |buffer: &mut Vec<String>, nodes: &mut Vec<SlateNode>| {
        if buffer.is_empty() {
            return;
        }
        let text = buffer.join(" ");
        nodes.push(SlateNode::Paragraph { text });
        buffer.clear();
    };

    for line in doc.raw().lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(":") && trimmed.ends_with(":") && trimmed.len() > 1 {
            in_drawer = !in_drawer;
            continue;
        }
        if in_drawer {
            continue;
        }

        if trimmed.is_empty() {
            flush_paragraph(&mut paragraph_buffer, &mut nodes);
            continue;
        }

        if let Some((asterisks, title)) = line.split_once(' ') {
            if asterisks.chars().all(|c| c == '*') {
                flush_paragraph(&mut paragraph_buffer, &mut nodes);
                let depth = asterisks.len() as u32;
                nodes.push(SlateNode::Heading {
                    depth,
                    text: title.trim().to_string(),
                });
                continue;
            }
        }

        if let Some(list_text) = parse_list_item(line) {
            flush_paragraph(&mut paragraph_buffer, &mut nodes);
            nodes.push(list_text);
            continue;
        }

        paragraph_buffer.push(trimmed.to_string());
    }

    flush_paragraph(&mut paragraph_buffer, &mut nodes);

    if nodes.is_empty() {
        nodes.push(SlateNode::Paragraph {
            text: doc.raw().to_string(),
        });
    }

    nodes
}

fn parse_list_item(line: &str) -> Option<SlateNode> {
    let indent = line.chars().take_while(|c| c.is_whitespace()).count();
    let trimmed = line[indent..].trim_start();

    if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("+ "))
        .or_else(|| trimmed.strip_prefix("* "))
    {
        return Some(SlateNode::ListItem {
            depth: (indent / 2 + 1) as u32,
            ordered: false,
            text: rest.trim().to_string(),
        });
    }

    if let Some(idx) = trimmed.find(|c: char| c == '.' || c == ')') {
        if trimmed[..idx].chars().all(|c| c.is_ascii_digit()) {
            let rest = trimmed[idx + 1..].trim_start();
            return Some(SlateNode::ListItem {
                depth: (indent / 2 + 1) as u32,
                ordered: true,
                text: rest.trim().to_string(),
            });
        }
    }

    None
}
