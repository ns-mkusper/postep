# iOS Packaging (Scaffold)

This directory will contain the Xcode project that embeds the Rust `org_app` crate.

## Planned Steps
1. Configure `cargo` to build `org_app` as a `staticlib` for `aarch64-apple-ios` and `x86_64-apple-ios` (simulator).
2. Generate an Xcode workspace (with `cargo-xcode` or manual project) that links the Rust artifact and exposes UIKit lifecycle hooks.
3. Use `eframe::ios::run` (or a custom Winit integration) to host the `egui` surface inside a `UIViewController`.
4. Bridge notification scheduling and calendar access via Swift wrappers that implement `NotificationSink`.

More detailed instructions will follow as the project matures.
