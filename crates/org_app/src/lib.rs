pub mod app;

#[cfg(target_os = "android")]
use std::path::PathBuf;

#[cfg(target_os = "android")]
use slint::platform::android::AndroidApp;

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn android_main(android_app: AndroidApp) {
    tracing_subscriber::fmt::init();

    if let Err(err) = slint::platform::android::init(android_app.clone()) {
        tracing::error!(%err, "Failed to initialise Slint Android backend");
        return;
    }

    let storage_root = android_app.internal_data_path().map(PathBuf::from);

    let mut config = app::AppConfig::from_env().unwrap_or_default();
    config.bootstrap_mobile_defaults(storage_root);

    if let Err(err) = app::run(config) {
        tracing::error!(%err, "Android runtime terminated unexpectedly");
    }
}
