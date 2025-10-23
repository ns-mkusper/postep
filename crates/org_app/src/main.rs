#[cfg(not(target_os = "android"))]
use eframe::{CreationContext, NativeOptions, Renderer};
#[cfg(not(target_os = "android"))]
use org_app::app::{create_app, AppConfig};

#[cfg(target_os = "android")]
fn main() {}

#[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
fn main() {
    run_desktop("Org Mobile");
}

#[cfg(all(not(target_os = "android"), target_os = "ios"))]
fn main() {
    run_desktop("Org Mobile (iOS)");
}

#[cfg(not(target_os = "android"))]
fn run_desktop(window_title: &str) {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env().unwrap_or_default();
    let mut native_options = NativeOptions::default();
    native_options.renderer = Renderer::Glow;
    let creator = move |cc: &CreationContext<'_>| create_app(config.clone(), cc);

    if let Err(err) = eframe::run_native(window_title, native_options, Box::new(creator)) {
        eprintln!("Failed to start {window_title}: {err}");
    }
}
