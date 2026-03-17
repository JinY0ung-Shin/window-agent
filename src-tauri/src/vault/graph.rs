use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::links::LinkIndex;

/// A node in the knowledge graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub agent: String,
    pub note_type: String,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub updated_at: String,
}

/// An edge in the knowledge graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub edge_type: String, // "wikilink" | "tag-cooccurrence"
}

/// Complete graph data for frontend rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Information about a note needed to build the graph.
pub struct NoteInfo {
    pub id: String,
    pub label: String,
    pub agent: String,
    pub note_type: String,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub updated_at: String,
    /// Whether this note is in shared/ scope
    pub is_shared: bool,
}

/// Build a graph from notes and the link index.
///
/// - `notes`: all loaded notes
/// - `link_index`: the current LinkIndex
/// - `agent_filter`: if Some, only include notes from this agent (+ shared if include_shared)
/// - `depth`: max link traversal depth from filtered notes (None = include all connected)
/// - `include_shared`: whether to include shared/ notes in the graph
pub fn build_graph(
    notes: &[NoteInfo],
    link_index: &LinkIndex,
    agent_filter: Option<&str>,
    depth: Option<u32>,
    include_shared: bool,
) -> GraphData {
    let note_map: HashMap<&str, &NoteInfo> = notes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Step 1: Determine seed nodes
    let seed_ids: HashSet<String> = notes
        .iter()
        .filter(|n| {
            if let Some(agent) = agent_filter {
                if n.agent == agent {
                    return true;
                }
                if include_shared && n.is_shared {
                    return true;
                }
                return false;
            }
            true
        })
        .map(|n| n.id.clone())
        .collect();

    // Step 2: Expand by depth (BFS from seed nodes)
    let included_ids = if let Some(max_depth) = depth {
        let mut included: HashSet<String> = seed_ids.clone();
        let mut frontier: Vec<String> = seed_ids.into_iter().collect();

        for _ in 0..max_depth {
            let mut next_frontier = Vec::new();
            for id in &frontier {
                // Outgoing links
                if let Some(refs) = link_index.outgoing.get(id) {
                    for lr in refs {
                        if lr.resolved && !included.contains(&lr.target_id) {
                            included.insert(lr.target_id.clone());
                            next_frontier.push(lr.target_id.clone());
                        }
                    }
                }
                // Incoming links
                if let Some(refs) = link_index.incoming.get(id) {
                    for lr in refs {
                        if lr.resolved && !included.contains(&lr.source_id) {
                            included.insert(lr.source_id.clone());
                            next_frontier.push(lr.source_id.clone());
                        }
                    }
                }
            }
            frontier = next_frontier;
            if frontier.is_empty() {
                break;
            }
        }
        included
    } else {
        seed_ids
    };

    // Step 3: Build nodes
    let graph_nodes: Vec<GraphNode> = included_ids
        .iter()
        .filter_map(|id| {
            note_map.get(id.as_str()).map(|n| GraphNode {
                id: n.id.clone(),
                label: n.label.clone(),
                agent: n.agent.clone(),
                note_type: n.note_type.clone(),
                tags: n.tags.clone(),
                confidence: n.confidence,
                updated_at: n.updated_at.clone(),
            })
        })
        .collect();

    // Step 4: Build edges (only between included nodes)
    let mut edges = Vec::new();
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();

    for id in &included_ids {
        if let Some(refs) = link_index.outgoing.get(id) {
            for lr in refs {
                if lr.resolved && included_ids.contains(&lr.target_id) {
                    let key = (lr.source_id.clone(), lr.target_id.clone());
                    if seen_edges.insert(key) {
                        edges.push(GraphEdge {
                            source: lr.source_id.clone(),
                            target: lr.target_id.clone(),
                            edge_type: "wikilink".to_string(),
                        });
                    }
                }
            }
        }
    }

    GraphData {
        nodes: graph_nodes,
        edges,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_notes() -> Vec<NoteInfo> {
        vec![
            NoteInfo {
                id: "a".into(),
                label: "Note A".into(),
                agent: "manager".into(),
                note_type: "knowledge".into(),
                tags: vec!["tag1".into()],
                confidence: 0.9,
                updated_at: "2026-01-01".into(),
                is_shared: false,
            },
            NoteInfo {
                id: "b".into(),
                label: "Note B".into(),
                agent: "manager".into(),
                note_type: "knowledge".into(),
                tags: vec!["tag1".into()],
                confidence: 0.8,
                updated_at: "2026-01-02".into(),
                is_shared: false,
            },
            NoteInfo {
                id: "c".into(),
                label: "Shared Note".into(),
                agent: "researcher".into(),
                note_type: "knowledge".into(),
                tags: vec![],
                confidence: 0.7,
                updated_at: "2026-01-03".into(),
                is_shared: true,
            },
        ]
    }

    fn make_test_link_index() -> LinkIndex {
        let mut outgoing = HashMap::new();
        outgoing.insert(
            "a".to_string(),
            vec![super::super::links::LinkRef {
                source_id: "a".into(),
                target_id: "b".into(),
                raw_link: "[[b]]".into(),
                display_text: None,
                line_number: 1,
                resolved: true,
            }],
        );
        LinkIndex {
            outgoing,
            incoming: HashMap::new(),
            tag_index: HashMap::new(),
        }
    }

    #[test]
    fn test_build_graph_no_filter() {
        let notes = make_test_notes();
        let index = make_test_link_index();
        let graph = build_graph(&notes, &index, None, None, true);
        assert_eq!(graph.nodes.len(), 3);
        assert_eq!(graph.edges.len(), 1);
    }

    #[test]
    fn test_build_graph_agent_filter_no_shared() {
        let notes = make_test_notes();
        let index = make_test_link_index();
        let graph = build_graph(&notes, &index, Some("manager"), None, false);
        // Should include a and b (agent=manager) but not c (shared)
        assert_eq!(graph.nodes.len(), 2);
    }

    #[test]
    fn test_build_graph_agent_filter_with_shared() {
        let notes = make_test_notes();
        let index = make_test_link_index();
        let graph = build_graph(&notes, &index, Some("manager"), None, true);
        assert_eq!(graph.nodes.len(), 3);
    }
}
