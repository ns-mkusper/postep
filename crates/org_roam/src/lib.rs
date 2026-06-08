use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use anyhow::Result;
use org_domain::{document::OrgDocument, service::OrgService};
use petgraph::graph::{Graph, NodeIndex};
use serde::{Deserialize, Serialize};
use tracing::instrument;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoamNode {
    pub id: String,
    pub title: String,
    pub path: PathBuf,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoamLink {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone)]
struct RoamDocumentMetadata {
    id: String,
    aliases: Vec<String>,
    title: String,
    tags: Vec<String>,
}

#[derive(Debug, Default)]
pub struct OrgRoamGraph {
    graph: Graph<RoamNode, RoamLink>,
    index_by_id: HashMap<String, NodeIndex>,
}

impl OrgRoamGraph {
    pub fn nodes(&self) -> impl Iterator<Item = &RoamNode> {
        self.graph.node_weights()
    }

    pub fn node_data(&self) -> Vec<RoamNode> {
        self.graph.node_weights().cloned().collect()
    }

    pub fn link_data(&self) -> Vec<RoamLink> {
        self.graph.edge_weights().cloned().collect()
    }

    pub fn backlinks_for(&self, node_id: &str) -> Vec<&RoamNode> {
        let Some(&idx) = self.index_by_id.get(node_id) else {
            return Vec::new();
        };
        self.graph
            .neighbors_directed(idx, petgraph::Incoming)
            .filter_map(|neighbor| self.graph.node_weight(neighbor))
            .collect()
    }
}

#[instrument(skip(service))]
pub fn build_roam_graph(service: &OrgService) -> Result<OrgRoamGraph> {
    let mut graph = OrgRoamGraph::default();
    let mut link_buffer: Vec<(String, String)> = Vec::new();
    let mut alias_to_node_id: HashMap<String, String> = HashMap::new();

    for path in service.list_documents() {
        let Ok(doc) = service.get_document(&path) else {
            continue;
        };
        if !is_roam_file(&path) {
            continue;
        }

        let metadata = document_metadata(&path, &doc);
        let node_index = graph.graph.add_node(RoamNode {
            id: metadata.id.clone(),
            title: metadata.title,
            path: path.clone(),
            tags: metadata.tags,
        });
        graph.index_by_id.insert(metadata.id.clone(), node_index);
        for alias in metadata.aliases {
            alias_to_node_id.insert(alias, metadata.id.clone());
        }

        link_buffer.extend(extract_links(metadata.id, &doc));
    }

    let mut seen_edges: HashSet<(String, String)> = HashSet::new();
    for (source, target_alias) in link_buffer {
        let target = alias_to_node_id
            .get(&target_alias)
            .cloned()
            .unwrap_or(target_alias);
        if source == target || !seen_edges.insert((source.clone(), target.clone())) {
            continue;
        }
        let (Some(&source_idx), Some(&target_idx)) = (
            graph.index_by_id.get(&source),
            graph.index_by_id.get(&target),
        ) else {
            continue;
        };
        graph
            .graph
            .add_edge(source_idx, target_idx, RoamLink { source, target });
    }

    Ok(graph)
}

fn document_metadata(path: &PathBuf, doc: &OrgDocument) -> RoamDocumentMetadata {
    let fallback_id = compute_node_id(path);
    let org_id = extract_org_id(doc.raw());
    let id = org_id.clone().unwrap_or_else(|| fallback_id.clone());
    let mut aliases = vec![fallback_id.clone(), id.clone()];
    if let Some(org_id) = org_id {
        aliases.push(org_id);
    }
    aliases.sort();
    aliases.dedup();

    RoamDocumentMetadata {
        id,
        aliases,
        title: extract_title(doc.raw()).unwrap_or(fallback_id),
        tags: extract_tags(doc.raw()),
    }
}

fn extract_links(node_id: String, doc: &OrgDocument) -> Vec<(String, String)> {
    doc.raw()
        .lines()
        .flat_map(parse_roam_links)
        .filter_map(normalize_link_target)
        .map(|target| (node_id.clone(), target))
        .collect()
}

fn parse_roam_links(line: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw = &after_start[..end];
        if !raw.is_empty() {
            let target = raw.split("][").next().unwrap_or(raw).trim();
            if !target.is_empty() {
                links.push(target.to_string());
            }
        }
        rest = &after_start[end + 2..];
    }
    links
}

#[cfg(test)]
fn parse_roam_link(line: &str) -> Option<String> {
    parse_roam_links(line).into_iter().next()
}

fn normalize_link_target(target: String) -> Option<String> {
    let trimmed = target.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http:")
        || trimmed.starts_with("https:")
        || trimmed.starts_with("mailto:")
    {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("id:")
        .or_else(|| trimmed.strip_prefix("ID:"))
        .or_else(|| trimmed.strip_prefix("file:"))
        .or_else(|| trimmed.strip_prefix("FILE:"))
        .unwrap_or(trimmed);
    let without_anchor = without_scheme
        .split('#')
        .next()
        .unwrap_or(without_scheme)
        .split("::")
        .next()
        .unwrap_or(without_scheme)
        .trim();
    let without_org = without_anchor
        .strip_suffix(".org")
        .or_else(|| without_anchor.strip_suffix(".ORG"))
        .unwrap_or(without_anchor);
    let normalized = without_org.rsplit('/').next().unwrap_or(without_org).trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn extract_title(raw: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("#+TITLE:")
            .or_else(|| trimmed.strip_prefix("#+title:"))
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn extract_org_id(raw: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix(":ID:")
            .or_else(|| trimmed.strip_prefix(":id:"))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn extract_tags(raw: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(filetags) = trimmed
            .strip_prefix("#+FILETAGS:")
            .or_else(|| trimmed.strip_prefix("#+filetags:"))
        {
            for tag in filetags.split(|ch: char| ch == ':' || ch.is_whitespace()) {
                let tag = tag.trim();
                if !tag.is_empty() {
                    tags.insert(tag.to_string());
                }
            }
        }
        if trimmed.starts_with('*') {
            if let Some(tag_block) = heading_tag_block(trimmed) {
                for tag in tag_block.split(':').filter(|tag| !tag.is_empty()) {
                    tags.insert(tag.to_string());
                }
            }
        }
    }
    let mut tags: Vec<_> = tags.into_iter().collect();
    tags.sort();
    tags
}

fn heading_tag_block(line: &str) -> Option<&str> {
    let before_tags = line.rsplit_once(' ')?;
    let candidate = before_tags.1;
    if candidate.len() > 2 && candidate.starts_with(':') && candidate.ends_with(':') {
        Some(candidate.trim_matches(':'))
    } else {
        None
    }
}

fn is_roam_file(path: &PathBuf) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".org"))
        .unwrap_or(false)
}

fn compute_node_id(path: &PathBuf) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use org_domain::document::OrgDocument;

    #[test]
    fn compute_node_id_from_path() {
        let path = PathBuf::from("/tmp/2025-01-01-daily.org");
        assert_eq!(compute_node_id(&path), "2025-01-01-daily");
    }

    #[test]
    fn parse_link_extracts_target() {
        assert_eq!(parse_roam_link("[[target]]"), Some("target".into()));
        assert_eq!(parse_roam_link("No link"), None);
    }

    #[test]
    fn extract_links_scans_document_lines() {
        let doc = OrgDocument::from_string("demo", "[[alpha]]\n[[beta]]".into());
        let links = extract_links("source".into(), &doc);
        assert_eq!(links.len(), 2);
    }

    #[test]
    fn parse_links_extracts_multiple_targets_and_descriptions() {
        assert_eq!(
            parse_roam_links("[[id:alpha][Alpha]] and [[beta.org][Beta]]"),
            vec!["id:alpha".to_string(), "beta.org".to_string()]
        );
    }

    #[test]
    fn normalize_link_targets_match_node_aliases() {
        assert_eq!(
            normalize_link_target("id:alpha".into()),
            Some("alpha".into())
        );
        assert_eq!(
            normalize_link_target("file:notes/beta.org::Heading".into()),
            Some("beta".into())
        );
        assert_eq!(normalize_link_target("https://example.com".into()), None);
    }

    #[test]
    fn metadata_reads_title_id_and_tags() {
        let doc = OrgDocument::from_string(
            "demo",
            "#+TITLE: Better title\n#+FILETAGS: :project:rust:\n:PROPERTIES:\n:ID: node-123\n:END:\n* TODO Work :daily:mobile:\n"
                .into(),
        );
        let metadata = document_metadata(&PathBuf::from("/tmp/fallback.org"), &doc);
        assert_eq!(metadata.id, "node-123");
        assert_eq!(metadata.title, "Better title");
        assert!(metadata.aliases.contains(&"fallback".to_string()));
        assert!(metadata.tags.contains(&"project".to_string()));
        assert!(metadata.tags.contains(&"daily".to_string()));
        assert!(metadata.tags.contains(&"mobile".to_string()));
    }
}
