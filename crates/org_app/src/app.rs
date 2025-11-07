use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

use anyhow::{Context, Result};
use chrono::{Datelike, Duration, Local, NaiveDate};
use org_core::{
    agenda::{AgendaItem, AgendaKind, Repeater, RepeaterUnit},
    habit::{Habit, HabitFrequency},
    OrgService, OrgServiceBuilder,
};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel, Weak as SlintWeak};
use tracing::{debug, info};

slint::include_modules!();
use slint_generatedAppWindow as ui;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub(crate) roots: Vec<PathBuf>,
    pub(crate) agenda_span_days: usize,
    pub(crate) agenda_start_offset_days: i64,
    pub(crate) deadline_warning_days: i64,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let mut config = Self::default();
        if let Ok(root) = std::env::var("ORG_ROOT") {
            config.push_root(PathBuf::from(root));
        }
        if let Ok(list) = std::env::var("ORG_ROOTS") {
            for path in std::env::split_paths(&list) {
                config.push_root(path);
            }
        }
        if let Ok(span) = std::env::var("ORG_AGENDA_SPAN_DAYS") {
            if let Ok(value) = span.trim().parse::<usize>() {
                if value > 0 {
                    config.agenda_span_days = value;
                }
            }
        }
        if let Ok(offset) = std::env::var("ORG_AGENDA_START_OFFSET_DAYS") {
            if let Ok(value) = offset.trim().parse::<i64>() {
                config.agenda_start_offset_days = value;
            }
        }
        if let Ok(warning) = std::env::var("ORG_DEADLINE_WARNING_DAYS") {
            if let Ok(value) = warning.trim().parse::<i64>() {
                config.deadline_warning_days = value.max(0);
            }
        }
        Ok(config)
    }

    pub(crate) fn push_root(&mut self, path: PathBuf) {
        if !self.roots.contains(&path) {
            info!(path = %path.display(), "registering root");
            self.roots.push(path.clone());
        }
        if path.is_dir() {
            self.collect_nested_roots(&path);
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub(crate) fn bootstrap_mobile_defaults(&mut self, storage_root: Option<PathBuf>) {
        if let Some(mut root) = storage_root {
            root.push("org");
            if let Err(err) = std::fs::create_dir_all(&root) {
                tracing::warn!(path = %root.display(), %err, "unable to prepare mobile org workspace");
            }
            self.push_root(root);
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[allow(dead_code)]
    pub(crate) fn bootstrap_mobile_defaults(&mut self, _storage_root: Option<PathBuf>) {}

    fn collect_nested_roots(&mut self, root: &Path) {
        let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
        let mut visited: HashSet<PathBuf> = HashSet::new();
        while let Some(current) = stack.pop() {
            if !visited.insert(current.clone()) {
                continue;
            }
            if !current.is_dir() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&current) else {
                continue;
            };
            let mut has_org_file = false;
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    // Avoid following symlinks infinitely
                    if !file_type.is_symlink() {
                        stack.push(path);
                    }
                } else if file_type.is_file() && is_org_file(&path) {
                    has_org_file = true;
                }
            }
            if has_org_file && !self.roots.contains(&current) {
                debug!(path = %current.display(), "discovered nested root");
                self.roots.push(current);
            }
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            agenda_span_days: 10,
            agenda_start_offset_days: 0,
            deadline_warning_days: 14,
        }
    }
}

#[derive(Clone)]
struct DocumentSession {
    path: PathBuf,
    original_text: String,
    current_text: String,
    editing: bool,
    dirty: bool,
}

struct OrgAppController {
    window: SlintWeak<ui::AppWindow>,
    service: OrgService,
    config: AppConfig,
    documents_model: Rc<VecModel<ui::DocumentListEntry>>,
    agenda_days_model: Rc<VecModel<ui::AgendaDay>>,
    doc_paths: Vec<PathBuf>,
    selected_doc: Option<DocumentSession>,
    selected_index: Option<usize>,
    agenda_lookup: HashMap<i32, AgendaItem>,
    next_agenda_id: i32,
}

impl OrgAppController {
    fn new(window: SlintWeak<ui::AppWindow>, config: AppConfig) -> Result<Self> {
        info!(
            root_count = config.roots.len(),
            "initializing controller with roots"
        );
        let mut builder: OrgServiceBuilder = OrgService::builder();
        for root in &config.roots {
            builder = builder.add_root(root);
        }
        let service = builder
            .build()
            .context("failed to initialize org service")?;

        Ok(Self {
            window,
            service,
            config,
            documents_model: Rc::new(VecModel::default()),
            agenda_days_model: Rc::new(VecModel::default()),
            doc_paths: Vec::new(),
            selected_doc: None,
            selected_index: None,
            agenda_lookup: HashMap::new(),
            next_agenda_id: 1,
        })
    }

    fn initialize(&mut self) -> Result<()> {
        info!("initializing UI state");
        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            let docs_model: ModelRc<ui::DocumentListEntry> = self.documents_model.clone().into();
            let days_model: ModelRc<ui::AgendaDay> = self.agenda_days_model.clone().into();
            window.set_documents(docs_model);
            window.set_agenda_days(days_model);
            window.set_status_message(SharedString::from("Loading workspace…"));
        }
        self.reload_all()
    }

    fn reload_all(&mut self) -> Result<()> {
        info!("reload requested");
        let start = Instant::now();
        self.service.reload_all()?;
        self.refresh_documents()?;
        self.refresh_agenda()?;
        self.ensure_selection()?;
        let elapsed = start.elapsed();
        info!(elapsed_ms = %elapsed.as_millis(), "reload completed");
        self.set_status("Workspace reloaded");
        Ok(())
    }

    fn refresh_documents(&mut self) -> Result<()> {
        let start = Instant::now();
        self.doc_paths = self
            .service
            .list_documents()
            .into_iter()
            .filter(|path| {
                path.file_name()
                    .and_then(|f| f.to_str())
                    .map(|name| {
                        if name.starts_with('.') {
                            debug!(path = %path.display(), "hiding hidden document");
                            false
                        } else {
                            true
                        }
                    })
                    .unwrap_or(true)
            })
            .collect();
        let entries: Vec<ui::DocumentListEntry> = self
            .doc_paths
            .iter()
            .map(|path| {
                let title = path
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("<unnamed>")
                    .to_string();
                ui::DocumentListEntry {
                    title: SharedString::from(title),
                    path: SharedString::from(path.display().to_string()),
                }
            })
            .collect();
        self.documents_model.set_vec(entries);
        info!(doc_count = self.doc_paths.len(), elapsed_ms = %start.elapsed().as_millis(), "documents refreshed");
        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            let docs_model: ModelRc<ui::DocumentListEntry> = self.documents_model.clone().into();
            window.set_documents(docs_model);
            window.set_selected_document(self.selected_index.map(|idx| idx as i32).unwrap_or(-1));
        }
        Ok(())
    }

    fn refresh_agenda(&mut self) -> Result<()> {
        let start = Instant::now();
        let snapshot = self.service.agenda_snapshot()?;
        let today = Local::now().date_naive();
        let span_days = self.config.agenda_span_days.max(1);
        let start_date = today
            .checked_add_signed(Duration::days(self.config.agenda_start_offset_days))
            .unwrap_or(today);
        let warning_days = self.config.deadline_warning_days.max(0);

        self.agenda_lookup.clear();
        self.next_agenda_id = 1;

        let mut days: Vec<ui::AgendaDay> = Vec::with_capacity(span_days);
        for offset in 0..span_days {
            let day = start_date + Duration::days(offset as i64);
            let entries =
                build_day_entries(&snapshot.items, &snapshot.habits, day, today, warning_days);

            let rows: Vec<ui::AgendaRow> = entries
                .into_iter()
                .map(|entry| self.convert_agenda_entry(entry))
                .collect();

            let model: ModelRc<ui::AgendaRow> = Rc::new(VecModel::from(rows)).into();
            days.push(ui::AgendaDay {
                heading: SharedString::from(format_day_heading(day, today)),
                entries: model,
            });
        }

        let day_count = days.len();
        self.agenda_days_model.set_vec(days);
        info!(
            day_groups = day_count,
            elapsed_ms = %start.elapsed().as_millis(),
            "agenda refreshed"
        );

        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            let days_model: ModelRc<ui::AgendaDay> = self.agenda_days_model.clone().into();
            window.set_agenda_days(days_model);
        }
        Ok(())
    }

    fn ensure_selection(&mut self) -> Result<()> {
        if self.selected_index.is_none() && !self.doc_paths.is_empty() {
            self.select_document(0)?;
        }
        Ok(())
    }

    fn select_document(&mut self, index: usize) -> Result<()> {
        if index >= self.doc_paths.len() {
            return Ok(());
        }
        let path = self.doc_paths[index].clone();
        let start = Instant::now();
        let doc = self
            .service
            .get_document(&path)
            .with_context(|| format!("unable to load {}", path.display()))?;

        self.selected_index = Some(index);
        self.selected_doc = Some(DocumentSession {
            path: path.clone(),
            original_text: doc.raw().to_string(),
            current_text: doc.raw().to_string(),
            editing: false,
            dirty: false,
        });

        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_selected_document(index as i32);
            window.set_document_title(SharedString::from(
                path.file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("<unnamed>"),
            ));
            window.set_document_path(SharedString::from(path.display().to_string()));
            window.set_document_content(SharedString::from(doc.raw()));
            window.set_document_editing(false);
            window.set_document_dirty(false);
        }
        let elapsed = start.elapsed();
        info!(path = %path.display(), elapsed_ms = %elapsed.as_millis(), "document selected");
        self.set_status(format!("Viewing {}", path.display()));
        Ok(())
    }

    fn toggle_editing(&mut self, editing: bool) {
        let Some(session) = self.selected_doc.as_mut() else {
            self.set_status("No document selected");
            return;
        };

        if !editing && session.dirty {
            self.set_status("Save or discard changes before leaving edit mode");
            return;
        }

        session.editing = editing;
        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_document_editing(editing);
        }
    }

    fn update_document_text(&mut self, text: SharedString) {
        let Some(session) = self.selected_doc.as_mut() else {
            return;
        };
        if !session.editing {
            return;
        }
        let new_text = text.to_string();
        let dirty = new_text != session.original_text;
        session.current_text = new_text;
        session.dirty = dirty;
        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_document_dirty(dirty);
        }
        if dirty {
            debug!("document marked dirty");
            self.set_status("Unsaved changes");
        }
    }

    fn save_document(&mut self) -> Result<()> {
        let path_display = {
            let Some(session) = self.selected_doc.as_mut() else {
                self.set_status("Select a document to save");
                return Ok(());
            };
            let start = Instant::now();
            if !session.editing {
                self.set_status("Enter edit mode before saving");
                return Ok(());
            }
            self.service
                .update_document(&session.path, session.current_text.clone())?;
            session.original_text = session.current_text.clone();
            session.dirty = false;
            session.editing = false;
            info!(path = %session.path.display(), elapsed_ms = %start.elapsed().as_millis(), "document saved");
            session.path.display().to_string()
        };

        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_document_dirty(false);
            window.set_document_editing(false);
            window.set_status_message(SharedString::from("Document saved"));
        }

        self.refresh_agenda()?;
        self.refresh_documents()?;
        self.set_status(format!("Saved {}", path_display));
        Ok(())
    }

    fn discard_document(&mut self) -> Result<()> {
        let Some(session) = self.selected_doc.as_mut() else {
            self.set_status("No document selected");
            return Ok(());
        };
        if !session.editing {
            return Ok(());
        }

        session.current_text = session.original_text.clone();
        session.editing = false;
        session.dirty = false;

        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_document_content(SharedString::from(&session.original_text));
            window.set_document_editing(false);
            window.set_document_dirty(false);
        }

        self.set_status("Changes discarded");
        Ok(())
    }

    fn mark_agenda_item_done(&mut self, id: i32) -> Result<()> {
        let Some(item) = self.agenda_lookup.get(&id).cloned() else {
            self.set_status("Unable to locate agenda entry");
            return Ok(());
        };
        let start = Instant::now();
        self.service.complete_agenda_item(&item)?;
        self.refresh_agenda()?;
        self.refresh_documents()?;
        info!(id, path = %item.path.display(), elapsed_ms = %start.elapsed().as_millis(), "agenda item completed");
        self.set_status("Item marked DONE");
        Ok(())
    }

    fn set_status(&self, message: impl Into<SharedString>) {
        if let Some(window_strong) = self.window.upgrade() {
            let window: ui::AppWindow = window_strong;
            window.set_status_message(message.into());
        }
    }

    fn convert_agenda_entry(&mut self, entry: AgendaEntryView) -> ui::AgendaRow {
        let metadata = if entry.metadata.is_empty() {
            SharedString::default()
        } else {
            SharedString::from(entry.metadata.join(" • "))
        };
        let mut id = -1;
        if entry.can_mark_done {
            if let Some(item) = entry.item.clone() {
                id = self.next_agenda_id;
                self.next_agenda_id += 1;
                self.agenda_lookup.insert(id, item);
            }
        }
        ui::AgendaRow {
            id,
            summary: SharedString::from(entry.summary),
            metadata,
            context: SharedString::from(entry.context.unwrap_or_default()),
            can_mark_done: entry.can_mark_done,
            is_overdue: entry.is_overdue,
        }
    }
}

struct AgendaItemOccurrence {
    prefix: Option<String>,
    is_overdue: bool,
    occurrence_date: NaiveDate,
}

struct AgendaEntryView {
    item: Option<AgendaItem>,
    summary: String,
    metadata: Vec<String>,
    context: Option<String>,
    can_mark_done: bool,
    is_overdue: bool,
    time: Option<chrono::NaiveTime>,
}

impl AgendaEntryView {
    fn from_occurrence(
        occurrence: AgendaItemOccurrence,
        item: AgendaItem,
        metadata: Vec<String>,
    ) -> Self {
        let mut summary = String::new();
        if let Some(prefix) = occurrence.prefix {
            summary.push_str(&prefix);
            summary.push_str(":  ");
        }
        if let Some(time) = item.time {
            summary.push_str(&time.format("%H:%M").to_string());
            summary.push(' ');
        }
        if let Some(todo) = &item.todo_keyword {
            summary.push_str(todo);
            summary.push(' ');
        }
        summary.push_str(&item.title);
        Self {
            item: Some(item.clone()),
            summary,
            metadata,
            context: if item.context.trim().is_empty() {
                None
            } else {
                Some(item.context.clone())
            },
            can_mark_done: item.todo_keyword.is_some(),
            is_overdue: occurrence.is_overdue,
            time: item.time,
        }
    }

    fn from_habit(
        _habit: &Habit,
        summary: String,
        metadata: Vec<String>,
        context: Option<String>,
    ) -> Self {
        Self {
            item: None,
            summary,
            metadata,
            context,
            can_mark_done: false,
            is_overdue: false,
            time: None,
        }
    }
}

pub fn run(config: AppConfig) -> Result<()> {
    info!("starting Slint runtime");
    let window = ui::AppWindow::new().context("failed to create UI window")?;
    let controller = Rc::new(RefCell::new(OrgAppController::new(
        window.as_weak(),
        config,
    )?));

    {
        let controller = Rc::clone(&controller);
        window.on_select_document(move |index| {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                let _ = ctrl.select_document(index as usize);
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_change_view(move |view| {
            if let Some(window) = controller.borrow().window.upgrade() {
                window.set_current_view(view);
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_request_editing(move |flag| {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                ctrl.toggle_editing(flag);
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_request_save(move || {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                if let Err(err) = ctrl.save_document() {
                    ctrl.set_status(format!("Save failed: {err}"));
                }
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_request_discard(move || {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                let _ = ctrl.discard_document();
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_request_reload(move || {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                if let Err(err) = ctrl.reload_all() {
                    ctrl.set_status(format!("Reload failed: {err}"));
                }
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_request_mark_done(move |id| {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                if let Err(err) = ctrl.mark_agenda_item_done(id) {
                    ctrl.set_status(format!("Unable to mark done: {err}"));
                }
            }
        });
    }
    {
        let controller = Rc::clone(&controller);
        window.on_document_content_changed(move |text| {
            if let Some(mut ctrl) = controller.try_borrow_mut().ok() {
                ctrl.update_document_text(text);
            }
        });
    }

    controller
        .borrow_mut()
        .initialize()
        .context("failed to initialize UI state")?;

    window.run().map_err(|e| anyhow::anyhow!(e))
}

fn format_day_heading(date: NaiveDate, today: NaiveDate) -> String {
    let calendar = date.format("%A, %B %d, %Y");
    let relative = format_relative_label(date, today);
    if relative.is_empty() {
        calendar.to_string()
    } else {
        format!("{} — {}", relative, calendar)
    }
}

fn format_relative_label(date: NaiveDate, today: NaiveDate) -> String {
    let diff = date.signed_duration_since(today).num_days();
    match diff {
        -1 => "Yesterday".to_string(),
        0 => "Today".to_string(),
        1 => "Tomorrow".to_string(),
        d if d < 0 => format!("{} days ago", -d),
        d => format!("In {} days", d),
    }
}

fn is_org_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("org"))
        .unwrap_or(false)
}

fn build_day_entries(
    items: &[AgendaItem],
    habits: &[Habit],
    day: NaiveDate,
    today: NaiveDate,
    warning_days: i64,
) -> Vec<AgendaEntryView> {
    let mut entries: Vec<AgendaEntryView> = Vec::new();

    for item in items {
        if let Some(occurrence) = describe_item_for_day(item, day, today, warning_days) {
            let metadata = agenda_metadata(item, day, occurrence.occurrence_date);
            entries.push(AgendaEntryView::from_occurrence(
                occurrence,
                item.clone(),
                metadata,
            ));
        }
    }

    for habit in habits {
        if habit_expected_on(habit, day) {
            let mut metadata = Vec::new();
            if let Some(repeater) = &habit.repeater {
                metadata.push(format!("Repeats {}", repeater.raw));
            }
            if let Some(last) = habit.last_repeat {
                metadata.push(format!("Last repeat {}", last));
            }
            if let Some((graph, streak)) = habit_history_summary(habit, 21, today) {
                metadata.push(format!("History {}", graph));
                metadata.push(format!(
                    "Streak {} day{}",
                    streak,
                    if streak == 1 { "" } else { "s" }
                ));
            }
            let summary = format!("Habit · {}", habit.title);
            entries.push(AgendaEntryView::from_habit(
                habit,
                summary,
                metadata,
                if habit.description.trim().is_empty() {
                    None
                } else {
                    Some(habit.description.clone())
                },
            ));
        }
    }

    entries.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| a.summary.cmp(&b.summary)));
    entries
}

fn agenda_metadata(item: &AgendaItem, day: NaiveDate, occurrence: NaiveDate) -> Vec<String> {
    let mut metadata = Vec::new();
    match item.kind {
        AgendaKind::Deadline => metadata.push("Deadline".to_string()),
        AgendaKind::Scheduled => metadata.push("Scheduled".to_string()),
        AgendaKind::Floating => {}
    }
    if let Some(raw) = &item.timestamp_raw {
        metadata.push(format!("<{}>", raw));
    }
    if occurrence != day {
        metadata.push(format!("Target {}", occurrence));
    }
    if let Some(file) = item
        .path
        .file_stem()
        .and_then(|f| f.to_str())
        .map(|s| s.to_string())
    {
        metadata.push(format!("[{}]", file));
    }
    metadata
}

fn describe_item_for_day(
    item: &AgendaItem,
    day: NaiveDate,
    today: NaiveDate,
    warning_days: i64,
) -> Option<AgendaItemOccurrence> {
    match item.kind {
        AgendaKind::Deadline => describe_deadline_for_day(item, day, today, warning_days),
        AgendaKind::Scheduled => describe_scheduled_for_day(item, day, today, warning_days),
        AgendaKind::Floating => None,
    }
}

fn describe_deadline_for_day(
    item: &AgendaItem,
    day: NaiveDate,
    today: NaiveDate,
    warning_days: i64,
) -> Option<AgendaItemOccurrence> {
    let due = item.date?;
    let occurrence = deadline_occurrence_for_day(due, item.repeater.as_ref(), day, today)?;
    let diff = occurrence.signed_duration_since(day).num_days();
    if diff > warning_days {
        return None;
    }
    if diff < 0 && day != today {
        return None;
    }
    let prefix = match diff.cmp(&0) {
        std::cmp::Ordering::Less => Some(format!("Due {} d. ago", -diff)),
        std::cmp::Ordering::Equal => Some("Due".to_string()),
        std::cmp::Ordering::Greater => {
            if diff == 1 {
                Some("Due in 1 day".to_string())
            } else {
                Some(format!("Due in {} d.", diff))
            }
        }
    };
    Some(AgendaItemOccurrence {
        prefix,
        is_overdue: diff < 0,
        occurrence_date: occurrence,
    })
}

fn describe_scheduled_for_day(
    item: &AgendaItem,
    day: NaiveDate,
    today: NaiveDate,
    warning_days: i64,
) -> Option<AgendaItemOccurrence> {
    let scheduled = item.date?;

    if item.repeater.is_none() && scheduled < day {
        if day == today {
            let diff = day.signed_duration_since(scheduled).num_days();
            return Some(AgendaItemOccurrence {
                prefix: Some(format!("Scheduled {} d. ago", diff)),
                is_overdue: true,
                occurrence_date: scheduled,
            });
        }
        return None;
    }

    let occurrence = if let Some(repeater) = item.repeater.as_ref() {
        advance_to_on_or_after(scheduled, repeater, day)?
    } else {
        scheduled
    };

    let diff = occurrence.signed_duration_since(day).num_days();
    if diff == 0 {
        return Some(AgendaItemOccurrence {
            prefix: None,
            is_overdue: day < today,
            occurrence_date: occurrence,
        });
    }

    if day == today {
        if diff > 0 && diff <= warning_days {
            return Some(AgendaItemOccurrence {
                prefix: Some(format_scheduled_future(diff)),
                is_overdue: false,
                occurrence_date: occurrence,
            });
        }
        if diff < 0 {
            return Some(AgendaItemOccurrence {
                prefix: Some(format!("Scheduled {} d. ago", -diff)),
                is_overdue: true,
                occurrence_date: occurrence,
            });
        }
    }
    None
}

fn format_scheduled_future(diff: i64) -> String {
    if diff == 1 {
        "Scheduled for tomorrow".to_string()
    } else {
        format!("Scheduled in {} d.", diff)
    }
}

fn advance_to_on_or_after(
    start: NaiveDate,
    repeater: &Repeater,
    target: NaiveDate,
) -> Option<NaiveDate> {
    let mut current = start;
    if current >= target {
        return Some(current);
    }
    let mut guard = 0;
    while current < target {
        guard += 1;
        if guard > 2048 {
            return None;
        }
        current = advance_once(current, repeater)?;
    }
    Some(current)
}

fn advance_once(date: NaiveDate, repeater: &Repeater) -> Option<NaiveDate> {
    match repeater.unit {
        RepeaterUnit::Day => date.checked_add_signed(Duration::days(repeater.amount.into())),
        RepeaterUnit::Week => date.checked_add_signed(Duration::weeks(repeater.amount.into())),
        RepeaterUnit::Month => add_months(date, repeater.amount.into()),
        RepeaterUnit::Year => add_years(date, repeater.amount.into()),
    }
}

fn deadline_occurrence_for_day(
    due: NaiveDate,
    repeater: Option<&Repeater>,
    day: NaiveDate,
    today: NaiveDate,
) -> Option<NaiveDate> {
    let Some(repeater) = repeater else {
        return Some(due);
    };
    let mut occurrence = due;
    if occurrence >= day {
        return Some(occurrence);
    }
    let mut guard = 0;
    while occurrence < day {
        guard += 1;
        if guard > 2048 {
            return None;
        }
        occurrence = advance_once(occurrence, repeater)?;
    }
    if occurrence < today {
        occurrence = today;
    }
    Some(occurrence)
}

fn habit_history_summary(habit: &Habit, days: usize, today: NaiveDate) -> Option<(String, usize)> {
    if days == 0 {
        return None;
    }
    if habit.repeater.is_none() && habit.log_entries.is_empty() {
        return None;
    }
    let log_dates: HashSet<NaiveDate> = habit.log_entries.iter().map(|entry| entry.date).collect();

    let mut graph = String::with_capacity(days);
    for offset in (0..days).rev() {
        let day = today - Duration::days(offset as i64);
        let expected =
            habit_expected_on(habit, day) || (habit.repeater.is_none() && log_dates.contains(&day));
        let done = log_dates.contains(&day);
        let cell = if done && expected {
            'X'
        } else if done {
            'o'
        } else if expected {
            '.'
        } else {
            '_'
        };
        graph.push(cell);
    }

    let mut streak = 0;
    for offset in 0..days {
        let day = today - Duration::days(offset as i64);
        let expected =
            habit_expected_on(habit, day) || (habit.repeater.is_none() && log_dates.contains(&day));
        if expected {
            if log_dates.contains(&day) {
                streak += 1;
            } else {
                break;
            }
        }
    }

    Some((graph, streak))
}

fn habit_expected_on(habit: &Habit, day: NaiveDate) -> bool {
    let repeater = match &habit.repeater {
        Some(repeater) => repeater,
        None => return false,
    };
    let frequency = match &repeater.frequency {
        Some(freq) => freq,
        None => return false,
    };
    let base = match habit.scheduled.or(habit.last_repeat) {
        Some(base) => base,
        None => return false,
    };
    if day == base {
        return true;
    }
    if day < base {
        return false;
    }
    match frequency {
        HabitFrequency::Daily(n) => {
            let diff = day.signed_duration_since(base).num_days();
            diff % i64::from(*n) == 0
        }
        HabitFrequency::Weekly(n) => {
            let diff = day.signed_duration_since(base).num_days();
            diff % (i64::from(*n) * 7) == 0
        }
        HabitFrequency::Monthly(n) => {
            if day.day() != base.day() {
                return false;
            }
            let month_diff = months_between(base, day);
            month_diff >= 0 && month_diff % (*n as i32) == 0
        }
        HabitFrequency::Yearly(n) => {
            if day.month() != base.month() || day.day() != base.day() {
                return false;
            }
            let year_diff = day.year() - base.year();
            year_diff >= 0 && year_diff % (*n as i32) == 0
        }
    }
}

fn add_months(date: NaiveDate, months: u32) -> Option<NaiveDate> {
    let total_months = date.year() * 12 + (date.month() as i32 - 1) + months as i32;
    let target_year = total_months.div_euclid(12);
    let target_month = (total_months.rem_euclid(12) + 1) as u32;
    let day = date.day().min(days_in_month(target_year, target_month));
    NaiveDate::from_ymd_opt(target_year, target_month, day)
}

fn add_years(date: NaiveDate, years: u32) -> Option<NaiveDate> {
    let target_year = date.year().checked_add(years as i32)?;
    let target_month = date.month();
    let mut target_day = date.day().min(days_in_month(target_year, target_month));
    if target_month == 2 && target_day == 29 && !is_leap_year(target_year) {
        target_day = 28;
    }
    NaiveDate::from_ymd_opt(target_year, target_month, target_day)
}

fn months_between(start: NaiveDate, end: NaiveDate) -> i32 {
    (end.year() - start.year()) * 12 + (end.month() as i32 - start.month() as i32)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
