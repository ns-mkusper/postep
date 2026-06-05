# Postep UI Redesign (Orgro-inspired)

This document captures the interaction model for Postep’s Lexical-backed front-end. The goal is to deliver the power and navigation comfort of Orgro while layering on Postep’s self-improvement features (agenda, habits, calendar, org-roam) and cloud sync requirements.

## Design Principles
- **Org-first browsing**: Treat Org notes as the primary surface, not a nested menu item. Instant outline control, visibility cycling, and reader modes mirror Orgro’s strengths.
- **Contextual productivity**: Agenda, habits, and calendars live beside the library, but stay linked to the open document so planning flows stay grounded in real notes.
- **Touch-centric efficiency**: One-handed navigation, large tap targets, and gesture support for folding/unfolding to keep parity with Orgro’s mobile UX quality.
- **Transparent sync**: Surface Drive/SAF sync state inline (status bar + per-root badges) so users trust the Google Drive backend.
- **Native rendering first**: Use Lexical for document/editor semantics while rendering Org projections with React Native primitives for Android reliability and performance.

## Global Layout
- **Bottom navigation bar** with five primary destinations: `Library`, `Agenda`, `Habits`, `Roam`, `Capture`. Each section owns a Lexical-backed projection tuned to the task.
- **Global search FAB** (floating action button) that opens a full-screen Spotlight overlay combining title/body search, filters (tags, TODO state), and quick-jump, similar to Orgro’s search palette.
- **Sync/status pill** anchored top-right showing the active Org root, Google Drive status, and outstanding sync jobs from `org_sync`.

## Library (Org Browser)
Mirrors Orgro’s tree-first browsing experience while keeping editing out of the way.

- **Root manager**: quick chips and Android SAF pickers register Org and Org-roam directories with the bridge/`OrgSyncService`.
- **Action-first surface**: users land on completion/scheduling actions; marking TODOs done or rescheduling happens via the Agenda tab, while habits have dedicated quick taps on the Habits tab.
- **Reader mode**: a “Show Document” button reveals a read-only Lexical projection of the selected note when needed. Inline text editing is scoped to focused block/list actions.
- **Backlinks drawer**: right swipe exposes org-roam backlinks with previews.

## Agenda
Inspired by Orgro’s focus on viewing but tailored to Postep’s planning.

- **Timeline view** with grouped days and sections for overdue, today, upcoming. Google Calendar events overlay as translucent cards.
- **Inline details**: tapping an agenda item opens a sheet with the relevant Org subtree rendered through the Lexical projection, allowing quick edits without switching tabs.
- **Batch actions**: multi-select to postpone, refile, or archive.
- **Filters**: quick chips for roots, tags, TODO keywords, and Agenda span.
- **Streak header**: top of the screen shows habit completion streaks relevant to the selected day.

## Habits
Combines Orgro’s reader feel with interactive streak tracking.

- **Calendar grid** showing habit completion dots pulled from logbook entries.
- **Timeline** of upcoming repeats with recommended next action.
- **Reflection prompts**: each habit can link to a note template (stored in Org) opened inline with the Lexical projection for journaling.
- **Completion gestures**: swipe right to check off today, triggering `org_sync` updates and calendar reminders if applicable.

## Roam
Brings org-roam graph insights into mobile-friendly views.

- **Graph explorer**: simplified force-directed view (Canvas via React Native Skia) with tappable nodes. Selecting a node opens a Lexical-backed detail pane showing note excerpt, tags, and backlinks.
- **Daily notes lane**: horizontally scrollable list of daily files (YYYY-MM-DD.org) with quick capture.
- **Query builder**: filter nodes by tag, TODO state, or date created using pills.

## Capture
Quick entry modeled after Orgro’s fast capture sheets but extended for Postep workflows.

- **Templates**: choose between daily review, habit reflection, quick task, meeting note.
- **Input**: Lexical-backed minimal editor/projection seeded with template content, with metadata pickers (deadline, tags) that write drawers into the Org file.
- **Destination selector**: choose target file/headline (recent spots + search) or default inbox.

## Navigation Patterns and Gestures
- Swipe left/right on bottom tabs to move between sections.
- Two-finger pinch in Library toggles Reader Mode.
- Swipe down on document to reveal quick actions (share, export, open in desktop).
- Hold FAB for split capture (text + voice note) saved to Drive as attachments.

## Lexical Projection Strategy
- **Block map** matches Org syntactic constructs to Lexical projection node types (heading, paragraph, planning, drawer, table, directive, code block, list item).
- **Native components** render TODO chips, habit streak charts, metadata drawers, tables, and calendar overlays with React Native `View` and `Text` primitives.
- **Editor state boundary** stays in Lexical core (`lexical` package) without `@lexical/react`, avoiding DOM assumptions in Android native surfaces.
- **Performance budgets** keep block movement, block edit, and Lexical projection generation under tight millisecond thresholds in `npm run test:ux`.

## Integration Touchpoints
- Library interacts with `org_sync` for file metadata and conflict resolution.
- Agenda/Habits draw from `org_domain::agenda_snapshot`, with real-time updates via `org_bridge` events.
- Roam loads graphs from `org_roam::build_roam_graph`, subscribing to deltas when sync completes.
- Capture funnels edits through the bridge’s patch API (to be implemented) to send modifications back to Rust before Drive upload.

## Deprecations from Legacy UI
- Remove the legacy two-button `Documents/Agenda` toggle.
- Replace `egui` layout assumptions with navigation-aware state machines in the React Native app.
- Retire the static split pane; use adaptive layout that shows sidebar only on tablets/desktop.
