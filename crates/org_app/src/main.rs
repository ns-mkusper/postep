use org_app::app::{run, AppConfig};

#[cfg(target_os = "android")]
fn main() {
    // Android entry-point handled via `lib.rs`.
}

#[cfg(not(target_os = "android"))]
fn main() {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env().unwrap_or_default();
    if let Err(err) = run(config) {
        eprintln!("Failed to start Postep: {err}");
    }
}
