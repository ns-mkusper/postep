# Android Storage Onboarding Prototype

This prototype captures the user flow and integration points required to mount an Org directory (and optional Org-roam directory) from Google Drive using Android’s Storage Access Framework (SAF).

## User Flow
1. **Directory request** – During onboarding we call `requestOrgDirectory` to present the SAF picker scoped to Google Drive. Users can optionally pass a previously granted URI so the picker opens at the right folder.
2. **Persist access** – Once SAF returns, we immediately call `persistPermissionsAsync` so the URI remains accessible across app restarts. Both the primary Org root and the optional Org-roam root run through the same flow.
3. **Warm caches** – The resolved URIs are registered with `OrgSyncService::register_root`, which hydrates the Rust caches and schedules Drive delta jobs.
4. **Background refresh** – A background task periodically calls `schedule_drive_delta` to enqueue Drive sync work. On app resume we also register a `LocalWatcher` job so in-flight edits propagate back to Org files.

## Bridge Stubs
- `packages/bridge/src/platform/android/saf.ts` provides starter functions that wrap Expo’s `StorageAccessFramework` APIs. These stubs report a simple `SafDirectoryHandle` and helpers to list and write files.
- The napi bridge (`crates/org_bridge`) can call into `org_sync::register_root` using the SAF URIs so that the Rust core reads via the same directory abstraction.

## Open Tasks
- Map SAF document change notifications to `OrgSyncService::schedule_local_watch`.
- Implement Google Drive REST delta polling inside `SyncJobKind::DriveDelta`.
- Persist the granted directory URIs and Google OAuth tokens in encrypted storage (e.g., `expo-secure-store`).

