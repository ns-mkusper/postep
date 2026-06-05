#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SCREENSHOT_DIR="${SCREENSHOT_DIR:-e2e-artifacts/android-screenshots}"
APP_ID="${APP_ID:-com.postep.mobile}"
mkdir -p "$SCREENSHOT_DIR"
rm -f "$SCREENSHOT_DIR"/*.png

log() {
  printf '[android-screenshots] %s\n' "$*"
}

cleanup() {
  if [[ -n "${METRO_PID:-}" ]]; then
    kill "$METRO_PID" >/dev/null 2>&1 || true
  fi
  if [[ -f /tmp/postep-expo-screenshots.log ]]; then
    log "Expo log tail"
    tail -120 /tmp/postep-expo-screenshots.log || true
  fi
}
trap cleanup EXIT

wait_for_text() {
  local text="$1"
  local timeout_seconds="${2:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 && adb exec-out cat /sdcard/window.xml | grep -Fq "$text"; then
      return 0
    fi
    sleep 2
  done

  log "Timed out waiting for text: $text"
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb exec-out cat /sdcard/window.xml || true
  return 1
}

capture() {
  local name="$1"
  local expected_text="$2"
  wait_for_text "$expected_text" 90
  sleep 2
  adb exec-out screencap -p > "$SCREENSHOT_DIR/${name}.png"
  test -s "$SCREENSHOT_DIR/${name}.png"
  log "Captured $SCREENSHOT_DIR/${name}.png"
}

open_route() {
  local route="$1"
  log "Opening route: $route"
  adb shell am start -W -a android.intent.action.VIEW -d "postep://$route" -p "$APP_ID" >/dev/null || \
    adb shell am start -W -a android.intent.action.VIEW -d "postep:///$route" -p "$APP_ID" >/dev/null || \
    adb shell monkey -p "$APP_ID" 1 >/dev/null
  sleep 4
}

log "Waiting for Android device"
adb wait-for-device
for _ in $(seq 1 60); do
  if adb shell cmd package list packages >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

log "Starting Metro"
adb reverse tcp:8081 tcp:8081 || true
EXPO_PUBLIC_POSTEP_E2E=1 CI=1 npx expo start --clear --host localhost > /tmp/postep-expo-screenshots.log 2>&1 &
METRO_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8081/status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8081/status >/dev/null || { cat /tmp/postep-expo-screenshots.log; exit 1; }

log "Installing debug APK"
npm run e2e:android:install

log "Launching app"
adb shell monkey -p "$APP_ID" 1 >/dev/null
for _ in $(seq 1 150); do
  if grep -q "Android Bundled" /tmp/postep-expo-screenshots.log; then
    break
  fi
  sleep 1
done
grep -q "Android Bundled" /tmp/postep-expo-screenshots.log || { cat /tmp/postep-expo-screenshots.log; exit 1; }
sleep 8

open_route "library"
capture "01-library-loaded" "Local Org"

# Open the first sample document from the library.
adb shell input tap 260 245 || true
capture "02-document-opened" "open app workflow"

open_route "agenda"
capture "03-agenda" "Agenda item 1"

open_route "habits"
capture "04-habits" "Morning habit"

open_route "roam"
capture "05-roam-graph" "Roam Nodes"

log "Screenshots ready"
ls -lh "$SCREENSHOT_DIR"
