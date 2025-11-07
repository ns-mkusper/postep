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

    for path in service.list_documents() {
        let Ok(doc) = service.get_document(&path) else {
            continue;
        };
        if !is_roam_file(&path) {
            continue;
        }

        let node_id = compute_node_id(&path);
        let node_index = graph.graph.add_node(RoamNode {
            id: node_id.clone(),
            title: compute_node_id(&path),
            path: path.clone(),
            tags: Vec::new(),
        });
        graph.index_by_id.insert(node_id.clone(), node_index);

        link_buffer.extend(extract_links(node_id, &doc));
    }

    let mut seen_edges: HashSet<(String, String)> = HashSet::new();
    for (source, target) in link_buffer {
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

fn extract_links(node_id: String, doc: &OrgDocument) -> Vec<(String, String)> {
    doc.raw()
        .lines()
        .filter_map(|line| parse_roam_link(line).map(|target| (node_id.clone(), target)))
        .collect()
}

fn parse_roam_link(line: &str) -> Option<String> {
    let start = line.find("[[")?;
    let rest = &line[start + 2..];
    let end = rest.find("]]")?;
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
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
}
