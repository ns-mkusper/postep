use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use org_domain::{document::OrgDocument, service::OrgService, slate::document_to_slate};
use tempfile::tempdir;

const BLOCK_RENDER_BUDGET: Duration = Duration::from_millis(18);
const AGENDA_REFRESH_BUDGET: Duration = Duration::from_millis(55);
const BLOCK_EDIT_BUDGET: Duration = Duration::from_millis(8);
const APP_LAUNCH_BUDGET: Duration = Duration::from_millis(80);

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, contents).expect("write fixture");
}

fn sample_org(index: usize) -> String {
    let day = format!("{:02}", index + 1);
    format!(
        r#"#+TITLE: UX Sample {index}
#+CATEGORY: postep
* TODO [#A] Morning habit {index} :habit:daily:
SCHEDULED: <2026-05-{day} Thu 06:30 +1d>
:PROPERTIES:
:STYLE: habit
:LAST_REPEAT: [2026-05-{day} Thu]
:END:
:LOGBOOK:
- State "DONE"       from "TODO"       [2026-05-{day} Thu]
- State "DONE"       from "TODO"       [2026-05-{day} Wed]
:END:
- [ ] open app
- [X] render org blocks
Notes with [[id:sample-{index}][sample link]] and enough text to simulate a real note card.

** TODO Follow-up child {index} :agenda:
DEADLINE: <2026-06-{day} Mon 09:00>
Context text for agenda regeneration.

* WAITING Project card {index} :work:
SCHEDULED: <2026-07-{day} Tue 13:00 +1w>
| Metric | Budget |
| Move   | 8ms    |
| Edit   | 8ms    |

#+BEGIN_SRC shell
echo sample-{index}
#+END_SRC
"#
    )
}

fn populate_local_org_area(root: &Path) -> Vec<PathBuf> {
    (0..10)
        .map(|index| {
            let path = root.join(format!("sample-{index}.org"));
            write_file(&path, &sample_org(index));
            path
        })
        .collect()
}

fn elapsed<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let value = f();
    (value, start.elapsed())
}

#[test]
fn launches_local_org_area_and_renders_ten_sample_files_inside_budget() {
    let temp = tempdir().expect("tempdir");
    populate_local_org_area(temp.path());

    let (service, launch_elapsed) = elapsed(|| {
        OrgService::builder()
            .add_root(temp.path())
            .build()
            .expect("launch org service")
    });
    assert!(
        launch_elapsed <= APP_LAUNCH_BUDGET,
        "app/service launch exceeded {:?}: {:?}",
        APP_LAUNCH_BUDGET,
        launch_elapsed
    );

    let docs = service.list_documents();
    assert_eq!(docs.len(), 10);

    let (rendered_count, render_elapsed) = elapsed(|| {
        docs.iter()
            .map(|path| {
                let doc = service.get_document(path).expect("document loaded");
                document_to_slate(&doc).len()
            })
            .sum::<usize>()
    });

    assert!(rendered_count >= 100, "expected rich block coverage");
    assert!(
        render_elapsed <= BLOCK_RENDER_BUDGET,
        "rendering 10 org files exceeded {:?}: {:?}",
        BLOCK_RENDER_BUDGET,
        render_elapsed
    );
}

#[test]
fn regenerates_agenda_and_habits_from_ten_sample_files_inside_budget() {
    let temp = tempdir().expect("tempdir");
    populate_local_org_area(temp.path());
    let service = OrgService::builder()
        .add_root(temp.path())
        .build()
        .expect("launch org service");

    let (snapshot, elapsed) = elapsed(|| service.agenda_snapshot().expect("agenda snapshot"));
    assert_eq!(snapshot.habits.len(), 10);
    assert!(snapshot.items.len() >= 30);
    assert!(
        elapsed <= AGENDA_REFRESH_BUDGET,
        "agenda refresh exceeded {:?}: {:?}",
        AGENDA_REFRESH_BUDGET,
        elapsed
    );
}

#[test]
fn edits_one_block_and_refreshes_rendering_inside_budget() {
    let temp = tempdir().expect("tempdir");
    let paths = populate_local_org_area(temp.path());
    let service = OrgService::builder()
        .add_root(temp.path())
        .build()
        .expect("launch org service");
    let path = &paths[0];
    let doc = service.get_document(path).expect("document loaded");
    let replacement = doc
        .raw()
        .replace("- [ ] open app", "- [X] open app and edit instantly");

    let (_, edit_elapsed) = elapsed(|| {
        service
            .update_document(path, replacement)
            .expect("update document");
        let refreshed = service.get_document(path).expect("refreshed doc");
        let rendered = document_to_slate(&refreshed);
        assert!(rendered.iter().any(|node| {
            serde_json::to_string(node)
                .expect("serialize node")
                .contains("edit instantly")
        }));
    });

    assert!(
        edit_elapsed <= BLOCK_EDIT_BUDGET,
        "block edit/render exceeded {:?}: {:?}",
        BLOCK_EDIT_BUDGET,
        edit_elapsed
    );
}

#[test]
fn slate_projection_handles_single_file_without_allocating_parser_state() {
    let raw = sample_org(42);
    let doc = OrgDocument::from_string("sample.org", raw);
    let (nodes, elapsed) = elapsed(|| document_to_slate(&doc));
    assert!(nodes.len() >= 10);
    assert!(
        elapsed <= Duration::from_millis(3),
        "single-file projection exceeded 3ms: {:?}",
        elapsed
    );
}
