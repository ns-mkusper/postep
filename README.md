# Postep

Postep is a work-in-progress Org mode viewer and editor targeting Android, iOS, and desktop platforms. The project pairs a Rust core that understands `.org` files with an `egui` front-end designed to deliver Emacs-like rendering, agenda views, and habit tracking on mobile devices.

## Crate Layout
- `crates/org_core`: Core domain logic for Org documents, habit extraction, agenda generation, and filesystem watching.
- `crates/org_app`: `eframe`/`egui` application shell that hosts the UI on desktop and mobile. This crate compiles to a native binary for desktop and a `cdylib` (`liborg_app.so`) for Android.

## Getting Started (Desktop Prototype)
The desktop build is the quickest way to iterate on UI changes before packaging mobile binaries.

```bash
cargo run -p org_app
```

Optional environment variables:
- `ORG_ROOT`: Set to a directory that contains Org files. When unset, the app starts with an empty library.
- `ORG_ROOTS`, `ORG_AGENDA_ROOTS`, `ORG_HABIT_ROOTS`: OS-specific path lists (e.g., `:` on macOS/Linux, `;` on Windows) that pre-populate the document, agenda, and habit directories.

In the running app, use the `File` menu to open individual Org files or whole directories (including synced locations such as Google Drive). The `Roots` menu displays currently tracked directories and lets you add dedicated agenda and habit directories without restarting.

The UI automatically switches to a single-column layout and touch-friendly styling on narrow/touch devices to keep the Org view usable on phones.

## Android Packaging

The `mobile/android` Gradle project builds a stock `NativeActivity` wrapper around the Rust library.

1. Install prerequisites:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
   cargo install cargo-ndk
   ```
2. Build the shared libraries (from repo root):
   ```bash
   cargo ndk \
     -t arm64-v8a -t armeabi-v7a -t x86_64 \
     -o mobile/android/app/src/main/jniLibs \
     --platform 33 \
     build --release -p org_app
   ```
3. Assemble the APK:
   ```bash
   cd mobile/android
   ./gradlew assembleDebug
   ```
4. Install on a device/emulator:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   adb shell am start -n com.postep/android.app.NativeActivity
   ```

The first launch prepares an internal `org` directory inside the app sandbox. Drop Org files there (via `adb push` or SAF) to populate the library. Notifications, calendar integration, and SAF pickers are waiting on platform adapters that implement `org_core::notifications::NotificationSink`.

## iOS Packaging

- `mobile/ios`: Xcode workspace (to be initialized) that embeds the Rust static library via `cargo-xcode` or `uniffi` style bridges.

## Roadmap
1. Flesh out platform adapters for notifications and calendar sync.
2. Implement storage pickers (Document Provider on Android, Files on iOS) so users can browse Google Drive, iCloud, etc., from the UI.
3. Synchronize with local storage providers (e.g., Files app, shared folders) and, later, cloud backends.

## Org Rendering Goals
- Preserve Emacs Org mode layout (headings, drawers, TODO keywords) using `egui` widgets.
- Provide a dedicated habit dashboard with streak indicators and completion logging.
- Integrate the agenda with native calendars for reminders and all-day events.

## Contributing
This repo is still in early scaffolding, so expect breaking changes. Contributions around Org parsing fidelity, touch-first `egui` design, and mobile build tooling are welcome.
