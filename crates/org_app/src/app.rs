use std::error::Error as StdError;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Error as AnyError, Result};
use eframe::egui::{self, ComboBox, RichText};
use eframe::{App, CreationContext};
use org_core::{document::OrgDocument, OrgService, OrgServiceBuilder};
use tracing::error;

#[cfg(any(target_os = "android", target_os = "ios"))]
use eframe::egui::{FontId, TextStyle};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tracing::warn;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use rfd::FileDialog;

#[derive(Clone, Debug, Default)]
pub struct AppConfig {
    pub(crate) document_roots: Vec<PathBuf>,
    pub(crate) agenda_roots: Vec<PathBuf>,
    pub(crate) habit_roots: Vec<PathBuf>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let mut config = Self::default();
        if let Ok(root) = std::env::var("ORG_ROOT") {
            config.push_unique_document(PathBuf::from(root));
        }
        if let Ok(list) = std::env::var("ORG_ROOTS") {
            for path in std::env::split_paths(&list) {
                config.push_unique_document(path);
            }
        }
        if let Ok(root) = std::env::var("ORG_AGENDA_ROOT") {
            config.push_unique_agenda(PathBuf::from(root));
        }
        if let Ok(list) = std::env::var("ORG_AGENDA_ROOTS") {
            for path in std::env::split_paths(&list) {
                config.push_unique_agenda(path);
            }
        }
        if let Ok(root) = std::env::var("ORG_HABIT_ROOT") {
            config.push_unique_habit(PathBuf::from(root));
        }
        if let Ok(list) = std::env::var("ORG_HABIT_ROOTS") {
            for path in std::env::split_paths(&list) {
                config.push_unique_habit(path);
            }
        }
        Ok(config)
    }

    pub(crate) fn push_unique_document(&mut self, path: PathBuf) {
        if !self.document_roots.contains(&path) {
            self.document_roots.push(path);
        }
    }

    pub(crate) fn push_unique_agenda(&mut self, path: PathBuf) {
        if !self.agenda_roots.contains(&path) {
            self.agenda_roots.push(path);
        }
    }

    pub(crate) fn push_unique_habit(&mut self, path: PathBuf) {
        if !self.habit_roots.contains(&path) {
            self.habit_roots.push(path);
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub(crate) fn bootstrap_mobile_defaults(&mut self, storage_root: Option<PathBuf>) {
        if let Some(mut root) = storage_root {
            root.push("org");
            if let Err(err) = fs::create_dir_all(&root) {
                warn!(path = %root.display(), %err, "unable to prepare mobile org workspace");
            }
            self.push_unique_document(root.clone());
            self.push_unique_agenda(root.clone());
            self.push_unique_habit(root);
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[allow(dead_code, unused_variables)]
    pub(crate) fn bootstrap_mobile_defaults(&mut self, _storage_root: Option<PathBuf>) {}
}

#[derive(Default)]
struct AppState {
    selected_doc: Option<PathBuf>,
    current_view: PrimaryView,
    last_error: Option<String>,
    edit_target: Option<PathBuf>,
    edit_buffer: Option<String>,
    is_editing: bool,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    style_hydrated: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PrimaryView {
    Documents,
    Habits,
    Agenda,
}

impl Default for PrimaryView {
    fn default() -> Self {
        PrimaryView::Documents
    }
}

#[derive(Clone, Copy)]
enum FileMenuAction {
    OpenFile,
    OpenDirectory,
}

#[derive(Clone, Copy)]
enum RootsMenuAction {
    AddAgenda,
    AddHabit,
}

pub struct OrgMobileApp {
    service: OrgService,
    state: AppState,
    config: AppConfig,
}

impl OrgMobileApp {
    pub fn new(config: AppConfig) -> Result<Self> {
        let mut builder: OrgServiceBuilder = OrgService::builder();
        for root in &config.document_roots {
            builder = builder.add_document_root(root);
        }
        for root in &config.agenda_roots {
            builder = builder.add_agenda_root(root);
        }
        for root in &config.habit_roots {
            builder = builder.add_habit_root(root);
        }
        let service = builder
            .build()
            .context("failed to initialize org service")?;
        Ok(Self {
            service,
            state: AppState::default(),
            config,
        })
    }

    pub fn from_error(config: AppConfig, err: AnyError) -> Self {
        error!(%err, "failed to initialize org service, continuing with empty state");
        let service = OrgService::builder()
            .build()
            .expect("empty builder should succeed");
        let mut state = AppState::default();
        state.last_error = Some(err.to_string());
        Self {
            service,
            state,
            config,
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn bootstrap_style(&mut self, ctx: &egui::Context) {
        if self.state.style_hydrated {
            return;
        }
        self.state.style_hydrated = true;
        ctx.set_pixels_per_point(ctx.pixels_per_point().max(1.5));
        let mut style = (*ctx.style()).clone();
        style.spacing.item_spacing = egui::vec2(12.0, 12.0);
        style.spacing.button_padding = egui::vec2(16.0, 12.0);
        style
            .text_styles
            .insert(TextStyle::Heading, FontId::proportional(26.0));
        style
            .text_styles
            .insert(TextStyle::Body, FontId::proportional(20.0));
        style
            .text_styles
            .insert(TextStyle::Button, FontId::proportional(22.0));
        style
            .text_styles
            .insert(TextStyle::Monospace, FontId::monospace(18.0));
        ctx.set_style(style);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn bootstrap_style(&mut self, _ctx: &egui::Context) {}

    fn handle_error(&mut self, err: AnyError) {
        self.state.last_error = Some(err.to_string());
    }

    fn cancel_edit(&mut self) {
        self.state.is_editing = false;
        self.state.edit_buffer = None;
        self.state.edit_target = None;
    }

    fn begin_edit(&mut self, path: &Path, document: &OrgDocument) {
        self.state.edit_target = Some(path.to_path_buf());
        self.state.edit_buffer = Some(document.raw().to_string());
        self.state.is_editing = true;
        self.state.last_error = None;
    }

    fn add_document_root(&mut self, path: PathBuf) {
        if path.is_dir() && !path.exists() {
            if let Err(err) = fs::create_dir_all(&path) {
                self.handle_error(err.into());
                return;
            }
        }
        match self.service.add_document_root(path.clone()) {
            Ok(()) => {
                self.config.push_unique_document(path.clone());
                self.state.selected_doc = Some(path);
                self.state.last_error = None;
            }
            Err(err) => self.handle_error(err),
        }
    }

    fn add_agenda_root(&mut self, path: PathBuf) {
        if path.is_dir() && !path.exists() {
            if let Err(err) = fs::create_dir_all(&path) {
                self.handle_error(err.into());
                return;
            }
        }
        match self.service.add_agenda_root(path.clone()) {
            Ok(()) => {
                self.config.push_unique_agenda(path);
                self.state.last_error = None;
            }
            Err(err) => self.handle_error(err),
        }
    }

    fn add_habit_root(&mut self, path: PathBuf) {
        if path.is_dir() && !path.exists() {
            if let Err(err) = fs::create_dir_all(&path) {
                self.handle_error(err.into());
                return;
            }
        }
        match self.service.add_habit_root(path.clone()) {
            Ok(()) => {
                self.config.push_unique_habit(path);
                self.state.last_error = None;
            }
            Err(err) => self.handle_error(err),
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn pick_org_file(&mut self) -> Option<PathBuf> {
        FileDialog::new()
            .add_filter("Org files", &["org"])
            .pick_file()
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    fn pick_org_file(&mut self) -> Option<PathBuf> {
        self.state.last_error =
            Some("File selection is not yet available on mobile builds".to_string());
        None
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn pick_org_directory(&mut self) -> Option<PathBuf> {
        FileDialog::new().pick_folder()
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    fn pick_org_directory(&mut self) -> Option<PathBuf> {
        self.state.last_error =
            Some("Directory selection is not yet available on mobile builds".to_string());
        None
    }

    fn open_org_file_dialog(&mut self) {
        if let Some(path) = self.pick_org_file() {
            self.add_document_root(path);
        }
    }

    fn open_org_directory_dialog(&mut self) {
        if let Some(path) = self.pick_org_directory() {
            self.add_document_root(path);
        }
    }

    fn add_agenda_directory_dialog(&mut self) {
        if let Some(path) = self.pick_org_directory() {
            self.add_agenda_root(path);
        }
    }

    fn add_habit_directory_dialog(&mut self) {
        if let Some(path) = self.pick_org_directory() {
            self.add_habit_root(path);
        }
    }

    fn render_document_preview(&mut self, ui: &mut egui::Ui, path: &Path) {
        match self.service.get_document(path) {
            Ok(document) => {
                let title = document
                    .path()
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("Document");

                let editing_this = self.state.is_editing
                    && self
                        .state
                        .edit_target
                        .as_ref()
                        .map(|p| p == path)
                        .unwrap_or(false);

                ui.horizontal(|ui| {
                    ui.heading(title);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if editing_this {
                            if ui.button("Cancel").clicked() {
                                self.cancel_edit();
                            }
                            if ui.button("Save").clicked() {
                                if let Some(buffer) = self.state.edit_buffer.clone() {
                                    match self.service.update_document(path, buffer.clone()) {
                                        Ok(()) => {
                                            self.cancel_edit();
                                            self.state.last_error = None;
                                        }
                                        Err(err) => self.handle_error(err),
                                    }
                                }
                            }
                        } else if ui.button("Edit").clicked() {
                            self.begin_edit(path, &document);
                        }
                    });
                });

                ui.separator();

                if editing_this {
                    let buffer = self
                        .state
                        .edit_buffer
                        .get_or_insert_with(|| document.raw().to_string());
                    egui::ScrollArea::vertical()
                        .id_salt("editor_scroll")
                        .show(ui, |ui| {
                            ui.add(
                                egui::TextEdit::multiline(buffer)
                                    .desired_width(f32::INFINITY)
                                    .code_editor()
                                    .lock_focus(true)
                                    .desired_rows(20),
                            );
                        });
                } else {
                    egui::ScrollArea::vertical()
                        .id_salt("viewer_scroll")
                        .show(ui, |ui| {
                            render_org_content(ui, document.raw());
                        });
                }
            }
            Err(err) => {
                self.state.last_error = Some(err.to_string());
                ui.colored_label(egui::Color32::RED, "Failed to load document");
            }
        }
    }

    fn show_documents(&mut self, _ctx: &egui::Context, ui: &mut egui::Ui) {
        let docs = self.service.list_documents();
        let mut selected = self
            .state
            .selected_doc
            .clone()
            .or_else(|| docs.first().cloned());
        if self.state.selected_doc.is_none() {
            self.state.selected_doc = selected.clone();
            self.cancel_edit();
        }

        #[cfg(any(target_os = "android", target_os = "ios"))]
        let compact_layout = true;
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        let compact_layout = ui.available_width() < 640.0;

        if docs.is_empty() {
            ui.centered_and_justified(|ui| {
                ui.label("No .org files loaded yet.");
            });
            return;
        }

        if compact_layout {
            let mut selected_index = selected
                .as_ref()
                .and_then(|path| docs.iter().position(|candidate| candidate == path))
                .unwrap_or(0);
            let selected_label = docs
                .get(selected_index)
                .and_then(|path| path.file_name())
                .and_then(|f| f.to_str())
                .unwrap_or("Select a document");
            ComboBox::from_label("Document")
                .selected_text(selected_label)
                .width(ui.available_width())
                .show_ui(ui, |ui| {
                    for (index, doc) in docs.iter().enumerate() {
                        let label = doc
                            .file_name()
                            .and_then(|f| f.to_str())
                            .unwrap_or("<unnamed>");
                        ui.selectable_value(&mut selected_index, index, label);
                    }
                });
            if let Some(choice) = docs.get(selected_index) {
                if self.state.selected_doc.as_ref() != Some(choice) {
                    self.state.selected_doc = Some(choice.clone());
                    selected = Some(choice.clone());
                    self.cancel_edit();
                }
            }

            if let Some(path) = selected.as_ref() {
                self.render_document_preview(ui, path);
            }
        } else {
            ui.columns(2, |columns| {
                let mut iter = columns.iter_mut();
                let left = iter.next().expect("left column");
                let right = iter.next().expect("right column");

                egui::ScrollArea::vertical().show(left, |ui| {
                    for doc in &docs {
                        let label = doc
                            .file_name()
                            .and_then(|f| f.to_str())
                            .unwrap_or("<unnamed>");
                        let is_selected = self.state.selected_doc.as_ref() == Some(doc);
                        if ui.selectable_label(is_selected, label).clicked() {
                            if self.state.selected_doc.as_ref() != Some(doc) {
                                self.state.selected_doc = Some(doc.clone());
                                self.cancel_edit();
                            }
                        }
                    }
                });

                if let Some(path) = self.state.selected_doc.clone().or_else(|| selected) {
                    self.render_document_preview(right, &path);
                } else {
                    right.label("Select a document to preview");
                }
            });
        }
    }

    fn show_habits(&mut self, ui: &mut egui::Ui) {
        match self.service.habits() {
            Ok(habits) => {
                if habits.is_empty() {
                    ui.label("No habits found");
                    return;
                }
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for habit in habits {
                        ui.group(|ui| {
                            ui.heading(&habit.title);
                            if let Some(date) = habit.scheduled {
                                ui.label(format!("Scheduled: {}", date));
                            }
                            if !habit.description.is_empty() {
                                ui.label(&habit.description);
                            }
                        });
                        ui.add_space(8.0);
                    }
                });
            }
            Err(err) => {
                self.state.last_error = Some(err.to_string());
                ui.colored_label(egui::Color32::RED, "Habit parsing failed");
            }
        }
    }

    fn show_agenda(&mut self, ui: &mut egui::Ui) {
        match self.service.agenda() {
            Ok(items) => {
                if items.is_empty() {
                    ui.label("Agenda is empty");
                    return;
                }
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for item in items {
                        ui.group(|ui| {
                            ui.heading(&item.title);
                            if let Some(date) = item.date {
                                ui.label(format!("Date: {}", date));
                            }
                            if let Some(timestamp) = item.scheduled_time {
                                ui.label(format!("Time: {}", timestamp));
                            }
                            if !item.context.is_empty() {
                                ui.label(&item.context);
                            }
                        });
                        ui.add_space(8.0);
                    }
                });
            }
            Err(err) => {
                self.state.last_error = Some(err.to_string());
                ui.colored_label(egui::Color32::RED, "Agenda generation failed");
            }
        }
    }
}

impl App for OrgMobileApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.bootstrap_style(ctx);

        let mut file_action = None;
        let mut roots_action = None;

        egui::TopBottomPanel::top("top_bar").show(ctx, |ui| {
            egui::MenuBar::new().ui(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.menu_button("File", |ui| {
                        if ui.button("Open Org File…").clicked() {
                            file_action = Some(FileMenuAction::OpenFile);
                            ui.close();
                        }
                        if ui.button("Open Org Directory…").clicked() {
                            file_action = Some(FileMenuAction::OpenDirectory);
                            ui.close();
                        }
                    });

                    ui.menu_button("Roots", |ui| {
                        if ui.button("Add Agenda Directory…").clicked() {
                            roots_action = Some(RootsMenuAction::AddAgenda);
                            ui.close();
                        }
                        if ui.button("Add Habit Directory…").clicked() {
                            roots_action = Some(RootsMenuAction::AddHabit);
                            ui.close();
                        }

                        egui::ScrollArea::vertical()
                            .max_height(200.0)
                            .show(ui, |ui| {
                                ui.separator();
                                ui.label("Document roots:");
                                for root in self.service.document_roots() {
                                    ui.label(root.display().to_string());
                                }
                                ui.separator();
                                ui.label("Agenda roots:");
                                for root in self.service.agenda_roots() {
                                    ui.label(root.display().to_string());
                                }
                                ui.separator();
                                ui.label("Habit roots:");
                                for root in self.service.habit_roots() {
                                    ui.label(root.display().to_string());
                                }
                            });
                    });

                    if ui.button("Documents").clicked() {
                        self.state.current_view = PrimaryView::Documents;
                    }
                    if ui.button("Habits").clicked() {
                        self.state.current_view = PrimaryView::Habits;
                    }
                    if ui.button("Agenda").clicked() {
                        self.state.current_view = PrimaryView::Agenda;
                    }
                    if ui.button("Reload").clicked() {
                        if let Err(err) = self.service.reload_all() {
                            self.state.last_error = Some(err.to_string());
                        }
                    }
                });
                if let Some(err) = self.state.last_error.as_ref() {
                    ui.separator();
                    ui.label(RichText::new(err).color(egui::Color32::RED));
                }
            });
        });

        if let Some(action) = file_action {
            match action {
                FileMenuAction::OpenFile => self.open_org_file_dialog(),
                FileMenuAction::OpenDirectory => self.open_org_directory_dialog(),
            }
        }
        if let Some(action) = roots_action {
            match action {
                RootsMenuAction::AddAgenda => self.add_agenda_directory_dialog(),
                RootsMenuAction::AddHabit => self.add_habit_directory_dialog(),
            }
        }

        egui::CentralPanel::default().show(ctx, |ui| match self.state.current_view {
            PrimaryView::Documents => self.show_documents(ctx, ui),
            PrimaryView::Habits => self.show_habits(ui),
            PrimaryView::Agenda => self.show_agenda(ui),
        });
    }
}

pub fn create_app(
    config: AppConfig,
    cc: &CreationContext<'_>,
) -> Result<Box<dyn App>, Box<dyn StdError + Send + Sync>> {
    let _ = cc; // suppress unused warning for now (reserved for future customisation).
    let app = match OrgMobileApp::new(config.clone()) {
        Ok(app) => app,
        Err(err) => OrgMobileApp::from_error(config, err),
    };
    Ok(Box::new(app))
}

fn render_org_content(ui: &mut egui::Ui, raw: &str) {
    fn flush_src_block(ui: &mut egui::Ui, lang: &mut String, lines: &mut Vec<String>) {
        if lines.is_empty() {
            return;
        }
        let code = lines.join(
            "
",
        );
        egui::Frame::group(ui.style()).show(ui, |ui| {
            if !lang.is_empty() {
                ui.label(RichText::new(lang.clone()).monospace().weak());
            }
            ui.monospace(code);
        });
        lines.clear();
        lang.clear();
    }

    fn flush_quote_block(ui: &mut egui::Ui, lines: &mut Vec<String>) {
        if lines.is_empty() {
            return;
        }
        let body = lines.join(
            "
",
        );
        egui::Frame::group(ui.style())
            .fill(ui.style().visuals.extreme_bg_color)
            .show(ui, |ui| {
                ui.label(body);
            });
        lines.clear();
    }

    let mut in_src_block = false;
    let mut src_lang = String::new();
    let mut src_lines: Vec<String> = Vec::new();

    let mut in_quote_block = false;
    let mut quote_lines: Vec<String> = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim_end();

        if trimmed.starts_with("#+BEGIN_SRC") {
            in_src_block = true;
            src_lines.clear();
            src_lang = trimmed
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_string();
            continue;
        }

        if trimmed.starts_with("#+END_SRC") {
            in_src_block = false;
            flush_src_block(ui, &mut src_lang, &mut src_lines);
            continue;
        }

        if in_src_block {
            src_lines.push(line.to_string());
            continue;
        }

        if trimmed.starts_with("#+BEGIN_QUOTE") {
            in_quote_block = true;
            quote_lines.clear();
            continue;
        }

        if trimmed.starts_with("#+END_QUOTE") {
            in_quote_block = false;
            flush_quote_block(ui, &mut quote_lines);
            continue;
        }

        if in_quote_block {
            quote_lines.push(trimmed.to_string());
            continue;
        }

        if trimmed.is_empty() {
            ui.add_space(6.0);
            continue;
        }

        if trimmed.starts_with('*') {
            let level = trimmed.chars().take_while(|c| *c == '*').count();
            let title = trimmed[level..].trim();
            match level {
                0 | 1 => ui.heading(title),
                2 => ui.label(RichText::new(title).strong().size(20.0)),
                3 => ui.label(RichText::new(title).strong()),
                _ => ui.label(RichText::new(title).italics()),
            };
            continue;
        }

        if trimmed.starts_with("- ") || trimmed.starts_with("+ ") {
            ui.horizontal(|ui| {
                ui.label("•");
                ui.label(trimmed[2..].trim());
            });
            continue;
        }

        if let Some((prefix, rest)) = trimmed
            .split_once('.')
            .filter(|(p, _)| p.chars().all(|c| c.is_ascii_digit()))
        {
            ui.horizontal(|ui| {
                ui.label(format!("{}.", prefix));
                ui.label(rest.trim());
            });
            continue;
        }

        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            ui.monospace(trimmed);
            continue;
        }

        ui.label(trimmed);
    }

    if in_src_block {
        flush_src_block(ui, &mut src_lang, &mut src_lines);
    }

    if in_quote_block {
        flush_quote_block(ui, &mut quote_lines);
    }
}
