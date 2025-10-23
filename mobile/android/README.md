# Android Packaging

This Gradle project packages the Rust `org_app` crate as a native `NativeActivity` application. The Rust side exports `android_main`, and the APK simply loads the `liborg_app.so` built with `cargo-ndk`.

## Prerequisites
- Android Studio Flamingo or newer
- Android NDK r26 or newer (install via Android Studio SDK Manager)
- Rust targets: `aarch64-linux-android`, `armv7-linux-androideabi`, and optionally `x86_64-linux-android`
- [`cargo-ndk`](https://github.com/bbqsrc/cargo-ndk)

Install the Rust targets once:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-ndk
```

## Building the shared library
From the repository root run:

```bash
cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  -o mobile/android/app/src/main/jniLibs \
  --platform 33 \
  build --release -p org_app
```

The command places `liborg_app.so` inside the Gradle project's `jniLibs` directory.

## Packaging the APK
```
cd mobile/android
./gradlew assembleDebug
```

The resulting APK is written to `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## Running
Use Android Studio or plain `adb`:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.postep/android.app.NativeActivity
```

The app boots into the egui-driven UI. The first run prepares an internal documents directory (`<app data>/org`). Place Org files there or wire a cloud sync solution with Android's Files app.

## Notes
- The manifest uses `NativeActivity`, so there is no Java glue code. All lifecycle handling happens in Rust via `winit`.
- Notifications, calendar hooks, and SAF pickers still need platform bridges. See `org_core::notifications::NotificationSink` for the trait to implement.
- When testing in an emulator, prefer the x86_64 build (`-t x86_64`) to avoid ARM translation penalties.
