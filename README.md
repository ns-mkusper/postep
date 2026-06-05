# Postep

Postep is a self-improvement companion that treats your Emacs Org directories as the source of truth while delivering a touch-first Lexical-backed interface on Android and other platforms. It combines a high-performance Rust core with a React Native (Expo) surface so agenda planning, habit tracking, and org-roam knowledge work stay in sync across devices.

## Pillars
- **Org-first database**: Point Postep at any Org directory (local, Google Drive, or both) and it mirrors the files without converting them to a proprietary format.
- **Agenda focus**: Render the full Org agenda, including scheduled items, deadlines, and backlog triage, with inline actions to capture, complete, or reschedule tasks.
- **Habit coaching**: Surface Org habit streaks, punch cards, and trendlines so daily routines stay on track.
- **Calendar integration**: Map Org timestamps to Google Calendar for reminders and availability overlays while keeping Org as the canonical store.
- **Org-roam graph**: Explore backlinks, tags, and daily notes from your roam vault to support long-term self-improvement ecosystems.

## Architecture Snapshot
The detailed architecture blueprint lives in [`docs/architecture.md`](docs/architecture.md) with the Orgro-inspired Lexical UX in [`docs/ui-redesign.md`](docs/ui-redesign.md). At a glance, the stack looks like this:

1. **Rust core crates** (`crates/`): Parse Org files, generate agendas, compute habit metrics, sync storage providers, and build org-roam graphs. The crates compile both to native binaries (for tooling) and shared-library targets that feed the UI.
2. **TypeScript bridge** (`packages/bridge`, WIP): A `napi-rs` layer that exposes the Rust services to the mobile UI and translates Org documents into Lexical-compatible JSON payloads.
3. **Lexical UI** (`apps/mobile`, WIP): An Expo (React Native) application that uses Lexical for editor state and a native React Native projection for rendered Org blocks. Screens include Library, Agenda, Habits, Roam, and Capture.

## Current Repo Layout
This repository is migrating from an `egui` prototype to the Lexical/React Native architecture. The existing crates remain buildable while the mobile UI and bridge are being staged.

```
crates/
  org_domain     # Org parsing, agenda, habit, and Lexical document projection
  org_bridge     # Native bridge payloads for the TypeScript app
  org_core       # Legacy core logic retained during migration
  org_app        # Legacy egui shell kept for desktop testing during migration
apps/
  mobile         # Expo React Native app with Lexical-backed Org UI
packages/
  bridge         # TypeScript bridge API and local development harness
docs/
  architecture.md
  android-storage.md
  ui-redesign.md
```

## Getting Started (Migration Phase)
1. **Rust toolchain**: `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`
2. **Node/Expo toolchain**: run `npm install --legacy-peer-deps` inside `apps/mobile`.
3. **Mobile checks**: from `apps/mobile`, run `npm run typecheck`, `npm run test:ux`, `npm run e2e:web:build`, and `npm run e2e:web`.
4. **Android smoke build**: from `apps/mobile`, run `npm run e2e:android:prebuild` and `npm run e2e:android:build`.
5. **Desktop prototype**: `cargo run -p org_app` still launches the legacy egui app for testing Org parsing changes.

## Configuring Org Directories

### Lexical / Expo app
- Launch the app and open the **Library** tab. The root manager at the top lets you paste filesystem paths or, on Android, tap **Pick via Android SAF** to grant access to a Google Drive or local directory.
- Add your main Org directory under “Org Roots” and (optionally) your Org-roam vault under “Org-roam Roots”. The selections are passed to the Rust bridge, registered with `OrgSyncService`, and synced across the Agenda, Habits, Roam, and Capture screens automatically.
- You can remove roots at any time; the bridge will stop watching them and the UI will refresh to match.

### Legacy egui prototype
- Set environment variables before launching: `ORG_ROOT=/path/to/org cargo run -p org_app`.
- For multiple directories use `ORG_ROOTS`, e.g. `ORG_ROOTS="/path/to/org:/path/to/projects" cargo run -p org_app` (use `;` on Windows).

### Sample data
- Integration tests now generate synthetic Org data on the fly (see `crates/org_domain/tests/`). Use your own directories in development; the repository does not ship personal Org content.

Expect rapid changes as the bridge and Lexical layers come online. See [`docs/architecture.md`](docs/architecture.md) for the implementation roadmap and module responsibilities.
