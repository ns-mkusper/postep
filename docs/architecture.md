# Postep Slate Architecture

## Vision
Postep becomes a self-improvement companion that treats a directory of Emacs Org files as the system of record while delivering a touch-first, Slate-powered experience on Android and beyond. The app should feel native on phones, understand advanced Org constructs (agenda, habits, org-roam), and stay in lock-step with Google Drive and Google Calendar.

## Design References and Lessons Learned
- **Orgro mobile workflow**: Track a root folder of Org files, offer quick capture, background sync, and on-device parsing with a fast Org engine.citeturn0open1
- **Slate-first UI across platforms**: The Expo “DOM runtime” lets React and DOM-centric editors such as Slate render inside React Native surfaces, giving us a converged code path for mobile and desktop without abandoning native packaging.citeturn0search1
- **Android storage best practices**: Rely on Storage Access Framework (SAF) and Google Drive’s REST API for long-lived access to cloud-backed folders, instead of ad-hoc file paths.citeturn0search2
- **Org-roam knowledge graph**: Org-roam stores backlinks and node metadata in Org files, so we can parse the roam directory to build a graph layer that powers self-improvement journaling.citeturn0search3

These insights feed the architecture below.

## High-Level Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         React Native + Slate                    │
│  (Expo useDOM runtime, custom Slate toolkit, navigation)        │
└──────────────▲────────────────────┬──────────────────────────────┘
               │                    │
               │ GraphQL/IPC        │
               │                    ▼
┌──────────────┴──────────────────────────────────────────────────┐
│            TypeScript Bridge (napi-rs + React Query)            │
│  - DataLoaders for agenda/habits/roam                           │
│  - Background task dispatcher (expo-background-fetch)           │
└──────────────▲──────────────────────────────────────────────────┘
               │ FFI (napi)                                         
┌──────────────┴──────────────────────────────────────────────────┐
│                       Rust Core (crates)                         │
│ org_core    org_sync    org_roam    org_calendar    org_search   │
│  - Org AST parser    - Drive/SAF sync   - Graph builder          │
│  - Agenda engine      - Conflict resolver - Query DSL            │
│  - Habit tracker      - Watcher service  - Metrics pipeline      │
└──────────────▲──────────────────────────────────────────────────┘
               │
               │ File IO + Google APIs
               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Storage Providers: Local FS, Google Drive folder, Org-roam dir  │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Breakdown

### 1. Rust Core (`crates/`)
Create a multi-crate workspace that keeps performance-critical Org logic in Rust, mirroring Orgro’s separation between storage adapters and UI.citeturn0open1

- **`org_core`** (rename current crate to `org_domain`): extends the existing agenda, habit, and document parsing with coverage for drawers, properties, and logbooks so we honour Emacs semantics.
- **`org_sync`**: encapsulates filesystem and Google Drive directory syncing with conflict resolution (clock skew, duplicates) and file watchers inspired by Orgro’s continuous sync loop.citeturn0open1
- **`org_roam`**: parses roam-specific files (`.org-roam`, `roam.db` migrations) to surface backlinks, tags, and graph structure. It exposes APIs for nearest neighbour queries, backlink list, and graph traversal similar to the desktop plugin.citeturn0search3
- **`org_calendar`**: maps Org agenda data to Google Calendar events, handling time zones and recurrence. It produces ICS snapshots and uses incremental sync tokens when pushing to Google Calendar.
- **`org_search`**: builds inverted indexes for title/body/tags to power quick capture and goal review.

Each crate compiles into a shared `cdylib` for Android and a `napi` module for the JS runtime. We use `tracing`/`tracing-subscriber` for structured logs routed back to React Native devtools.

### 2. TypeScript Bridge (`packages/bridge`)
A Node-compatible bridge compiled with `napi-rs` exposes idiomatic TypeScript APIs such as `useAgendaQuery`, `useHabitSignals`, `useOrgRoamGraph`, and `useDriveSync`. It translates between Rust structs (serde) and Slate-compatible JSON payloads.

Responsibilities:
- Load Org directories on startup, hydrating caches into SQLite (via `expo-sqlite`) for offline support.
- Manage background tasks: periodic Drive `files.list` delta sync using saved page tokens; SAF document change subscriptions; agenda refresh triggers.
- Provide file pickers: request directories for Org root and Org-roam root; persist `persistedUriPermissions` so Android retains access, mirroring Orgro’s directory onboarding flow.citeturn0search2turn0open1
- Serve GraphQL-lite IPC (optional) for desktop/web builds.

### 3. UI Layer (`apps/mobile`)
Uses Expo 50+ with the DOM runtime so Slate renders identically on Android, iOS, and web builds.citeturn0search1

The Slate surface mirrors Orgro’s navigation style (tree-first library, reader mode, visibility cycling) while layering Postep’s planning features. Detailed flows live in [`docs/ui-redesign.md`](./ui-redesign.md). Highlights:
- **Library**: bottom-tab home with collapsible outline, inline TODO chips, reader mode toggle, backlinks drawer, and Drive sync status badges.
- **Agenda**: day-grouped timeline with Google Calendar overlays and inline editing sheets fed by `org_domain::agenda_snapshot`.
- **Habits**: streak dashboards backed by Org logbooks with swipe-to-complete gestures integrated with `org_sync`.
- **Roam**: mobile-friendly graph explorer plus daily notes lane using Slate panes for node details.
- **Capture**: template-driven quick capture that writes to the Org inbox via bridge patch APIs.

Navigation relies on `expo-router` for tab + stack coordination, React Query for data hydration, and Zustand for ephemeral UI state (palette visibility, selection, gesture hints).

### 4. Google Drive Integration
Two modes depending on user preference:
1. **SAF-backed directory**: user picks a Drive folder via Android’s document picker; we mirror content locally using `org_sync`’s watcher and SAF change notifications.
2. **Drive REST API**: when OAuth is granted, we keep a device-local cache keyed by Drive file IDs, employing incremental `changes.list` polling and uploading edits via resumable uploads.citeturn0search2

Conflicts resolved with a three-way merge that prefers Org headline granularity, surfacing merge UI within Slate when human review is needed.

### 5. Google Calendar Integration
`org_calendar` maps Org scheduled/deadline entries to Google Calendar events using the Calendar REST API. The bridge handles OAuth token storage (`expo-auth-session`). Agenda view overlays external calendar events so users see a unified schedule. Sync is bi-directional but Org remains the source of truth; external edits produce Org updates using property drawers to track calendar IDs.

### 6. Org-roam Support
During onboarding, the app asks for the Org-roam directory (can be different from the main Org root). We support Drive-backed roam folders via the same SAF/Drive mechanisms. The Rust crate builds a graph with node metadata, exposing queries for backlinks, graph neighbourhood, and tag filters that feed Slate visualisations.citeturn0search3

### 7. Android Build and Verification
- **Packaging**: `expo prebuild && npx expo run:android --variant release` generates a native Gradle project bundling the Rust shared library (`libpostep.so`) through the `napi-rs` Android loader.
- **Automated checks**: GitHub Actions matrix builds the Rust core under `aarch64-linux-android` using `cargo-ndk`, runs Jest + Detox UI smoke tests, and executes instrumentation tests on an Android emulator to verify the Slate UI boots and renders agenda data.
- **Manual verification**: `adb shell cmd shortcut create-trampoline` steps to grant SAF directories; QA run ensures Drive sync works offline/online.

### 8. Data Flow Summary
1. User chooses Org root + optional Org-roam root via SAF/OAuth.
2. Bridge registers directories with `org_sync`, which hydrates caches and streams change events to the JS layer.
3. Slate screens subscribe to queries; updates from Rust invalidate caches and push new snapshots via event channels.
4. User edits produce Slate operations → TypeScript diff → Rust patch application (line-oriented + AST diff) → persisted to FS/Drive.
5. Agenda and habit analytics recalc in Rust on change, and calendar sync tasks run opportunistically when network is available.

## Implementation Roadmap
1. **Refactor Rust workspace**: split existing `org_core` into dedicated crates, add `cdylib` targets, and establish `napi-rs` bindings.
2. **Create Expo/React Native app**: bootstrap `apps/mobile`, enable Expo DOM runtime, wire bridge layer, and stub Slate screens.
3. **Storage onboarding**: implement SAF pickers, Drive OAuth, and delta sync loops.
4. **Agenda & Habit MVP**: surface agenda timeline and habit dashboard with write-back.
5. **Org-roam graph & Google Calendar**: add roam parsing, graph visualisations, and calendar sync.
6. **QA & Android hardening**: instrumentation tests, offline resilience, release packaging.

## Migration Notes
- Keep current `egui` desktop shell temporarily (`crates/org_app_legacy`) until the Slate app reaches feature parity; reuse Rust crates underneath both front-ends.
- Provide migration CLI to copy user settings (roots, agendas) into the new configuration files stored as Org drawers or JSON.

## Risks
- Slate on React Native is enabled via the DOM runtime; performance on lower-end Android devices must be profiled, especially when running heavy Org parsing in Rust.
- SAF access to Google Drive can be slow for large trees; we mitigate with local SQLite caches and incremental sync tokens.
- Calendar bidirectional sync risks duplicate events if users edit from multiple clients; we guard with etags and Org property drawers storing canonical IDs.
