pub mod app;

#[cfg(target_os = "android")]
use app::{create_app, AppConfig};

#[cfg(target_os = "android")]
use eframe::{NativeOptions, Renderer};

#[cfg(target_os = "android")]
use winit::platform::android::activity::AndroidApp;
#[cfg(target_os = "android")]
use winit::platform::android::EventLoopBuilderExtAndroid;

#[cfg(target_os = "android")]
#[no_mangle]
#[allow(improper_ctypes_definitions)]
pub extern "C" fn android_main(android_app: AndroidApp) {
    tracing_subscriber::fmt::init();
    let storage_root = android_app.internal_data_path();
    let base_config = AppConfig::from_env().unwrap_or_default();

    let mut native_options = NativeOptions::default();
    native_options.renderer = Renderer::Wgpu;
    native_options.event_loop_builder = Some(Box::new(move |builder| {
        builder.with_android_app(android_app);
    }));

    let result = eframe::run_native(
        "Org Mobile",
        native_options,
        Box::new(move |cc| {
            let mut runtime_config = base_config.clone();
            runtime_config.bootstrap_mobile_defaults(storage_root.clone());
            create_app(runtime_config, cc)
        }),
    );

    if let Err(err) = result {
        tracing::error!(%err, "Android runtime terminated unexpectedly");
    }
}
