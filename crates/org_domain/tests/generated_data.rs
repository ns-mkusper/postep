use std::fs;
use std::path::PathBuf;

use org_domain::{agenda::AgendaKind, service::OrgService};
use tempfile::tempdir;

fn write_file(path: &PathBuf, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, contents).expect("write fixture");
}

#[test]
fn agenda_habits_and_capture_round_trip() {
    let temp = tempdir().expect("tempdir");
    let root = temp.path();

    let agenda_file = root.join("agenda.org");
    write_file(
        &agenda_file,
        "* TODO Call Mom\nSCHEDULED: <2025-11-07 Fri 09:00>\n\n* TODO Pay rent\nDEADLINE: <2025-11-10 Mon>\n",
    );

    let habit_file = root.join("habits.org");
    write_file(
        &habit_file,
        "* NEXT Morning routine\n:PROPERTIES:\n:STYLE:    habit\n:END:\nSCHEDULED: <2025-11-07 Fri .+1d>\n",
    );

    let roam_dir = root.join("roam");
    write_file(
        &roam_dir.join("20250101090000-daily.org"),
        "* Daily Note\n[[20250102090000-review]]",
    );
    write_file(
        &roam_dir.join("20250102090000-review.org"),
        "* Review\n[[20250101090000-daily]]",
    );

    let service = OrgService::builder()
        .add_root(root)
        .build()
        .expect("build org service");

    let mut agenda_items = service.agenda().expect("agenda");
    agenda_items.sort_by(|a, b| a.title.cmp(&b.title));

    assert!(agenda_items
        .iter()
        .any(|item| item.title.contains("Call Mom")));
    assert!(agenda_items
        .iter()
        .any(|item| matches!(item.kind, AgendaKind::Deadline)));

    let habits = service.habits().expect("habits");
    assert_eq!(habits.len(), 1);
    assert!(
        habits[0].title.contains("Morning routine"),
        "habit title should include descriptive text"
    );

    service
        .complete_headline(&agenda_file, 0)
        .expect("complete headline");
    let refreshed = service.agenda().expect("agenda");
    let completed = refreshed
        .iter()
        .find(|item| item.title.contains("Call Mom"))
        .expect("completed exists");
    assert!(completed.todo_keyword.as_deref() == Some("DONE"));

    let capture_text = "* TODO Review notes\nSCHEDULED: <2025-11-12 Wed>";
    service
        .append_to_document(&agenda_file, capture_text)
        .expect("append capture");
    let final_contents = fs::read_to_string(agenda_file).expect("read agenda file");
    assert!(final_contents.contains("Review notes"));

    let graph = org_roam::build_roam_graph(&service).expect("roam graph");
    let nodes = graph.node_data();
    assert!(nodes.len() >= 2);
    assert!(nodes
        .iter()
        .any(|node| node.id.contains("20250101090000-daily")));
    assert!(nodes
        .iter()
        .any(|node| node.id.contains("20250102090000-review")));
}
