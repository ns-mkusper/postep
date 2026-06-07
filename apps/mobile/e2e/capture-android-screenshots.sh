#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SCREENSHOT_DIR="${SCREENSHOT_DIR:-e2e-artifacts/android-screenshots}"
APP_ID="${APP_ID:-com.postep.mobile}"
APP_ACTIVITY="${APP_ACTIVITY:-${APP_ID}/.MainActivity}"
APK_PATH="${APK_PATH:-android/app/build/outputs/apk/debug/app-debug.apk}"
METRO_PORT="${METRO_PORT:-8081}"
EXPO_LOG="${EXPO_LOG:-/tmp/postep-expo-screenshots-${METRO_PORT}.log}"
ADB_SERIAL="${ADB_SERIAL:-${ANDROID_SERIAL:-}}"
mkdir -p "$SCREENSHOT_DIR"
rm -f "$SCREENSHOT_DIR"/*.png

log() {
  printf '[android-screenshots] %s\n' "$*"
}

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    adb -s "$ADB_SERIAL" "$@"
  else
    adb "$@"
  fi
}

kill_pid_and_children() {
  local pid="$1"

  if [[ -z "$pid" ]]; then
    return 0
  fi

  kill -- "-$pid" >/dev/null 2>&1 || true
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  fi
  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  kill -KILL -- "-$pid" >/dev/null 2>&1 || true
  if command -v pkill >/dev/null 2>&1; then
    pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  fi
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

kill_metro_port() {
  if command -v lsof >/dev/null 2>&1; then
    while read -r pid; do
      if [[ -n "$pid" && "$pid" != "$$" ]]; then
        log "Stopping process $pid listening on Metro port $METRO_PORT"
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done < <(lsof -tiTCP:"$METRO_PORT" -sTCP:LISTEN 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${METRO_PORT}/tcp" >/dev/null 2>&1 || true
  fi

  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -f "expo start .*--port ${METRO_PORT}" >/dev/null 2>&1 || true
    pkill -TERM -f "expo .*--port ${METRO_PORT}" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [[ -n "${METRO_PID:-}" ]]; then
    kill_pid_and_children "$METRO_PID"
  fi
  if [[ "${CI:-}" == "1" ]]; then
    kill_metro_port
  fi
  if [[ -n "${MAC_FORWARD_PID:-}" ]]; then
    kill_pid_and_children "$MAC_FORWARD_PID"
  fi
  if [[ -f "$EXPO_LOG" ]]; then
    log "Expo log tail"
    tail -120 "$EXPO_LOG" || true
  fi
}
trap cleanup EXIT

wait_for_text() {
  local text="$1"
  local timeout_seconds="${2:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if adb_cmd shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1; then
      local window_xml
      window_xml="$(adb_cmd exec-out cat /sdcard/window.xml || true)"
      if grep -Fq "$text" <<<"$window_xml"; then
        return 0
      fi
      if grep -Fq "isn't responding" <<<"$window_xml"; then
        log "Dismissing Android ANR dialog while waiting for: $text"
        adb_cmd shell input tap 540 1360 || true
        adb_cmd shell am start -W -n "$APP_ACTIVITY" >/dev/null || true
      fi
    fi
    sleep 2
  done

  log "Timed out waiting for text: $text"
  adb_cmd shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb_cmd exec-out cat /sdcard/window.xml || true
  return 1
}

capture() {
  local name="$1"
  local expected_text="$2"
  wait_for_text "$expected_text" 90
  sleep 2
  adb_cmd exec-out screencap -p > "$SCREENSHOT_DIR/${name}.png"
  test -s "$SCREENSHOT_DIR/${name}.png"
  log "Captured $SCREENSHOT_DIR/${name}.png"
}

open_route() {
  local route="$1"
  log "Opening route: $route"
  adb_cmd shell am start -W -a android.intent.action.VIEW -d "postep://$route" -p "$APP_ID" >/dev/null || \
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "postep:///$route" -p "$APP_ID" >/dev/null || \
    adb_cmd shell monkey -p "$APP_ID" 1 >/dev/null
  sleep 4
}

install_apk() {
  if adb_cmd install -r -t -d -g "$APK_PATH"; then
    return 0
  fi

  if [[ -n "$ADB_SERIAL" && "$ADB_SERIAL" == emulator-* ]] && command -v mac-adb > /dev/null 2>&1 && [[ -f "$APK_PATH" ]]; then
    local mac_host="${MAC_ANDROID_HOST:-mac-mini-1}"
    local remote_apk="/tmp/postep-${APP_ID//./-}-${METRO_PORT}.apk"
    log "Direct install failed; copying APK to $mac_host:$remote_apk for Mac-side adb"
    scp -o BatchMode=yes "$APK_PATH" "$mac_host:$remote_apk"
    adb_cmd install -r -t -d -g "$remote_apk"
    return 0
  fi

  return 1
}

start_mac_port_forward() {
  if [[ -n "$ADB_SERIAL" && "$ADB_SERIAL" == emulator-* ]] && command -v mac-adb >/dev/null 2>&1; then
    local mac_host="${MAC_ANDROID_HOST:-mac-mini-1}"
    log "Forwarding Mac localhost:$METRO_PORT to container Metro"
    ssh -o BatchMode=yes -N -R "127.0.0.1:${METRO_PORT}:127.0.0.1:${METRO_PORT}" "$mac_host" &
    MAC_FORWARD_PID=$!
    sleep 1
  fi
}

log "Waiting for Android device"
adb_cmd wait-for-device
for _ in $(seq 1 60); do
  if adb_cmd shell cmd package list packages >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

log "Starting Metro"
if [[ "${CI:-}" == "1" ]]; then
  kill_metro_port
fi
start_mac_port_forward
adb_cmd reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" || true
if command -v setsid >/dev/null 2>&1; then
  setsid env EXPO_PUBLIC_POSTEP_E2E=1 CI=1 npx expo start --clear --host localhost --port "$METRO_PORT" > "$EXPO_LOG" 2>&1 &
else
  EXPO_PUBLIC_POSTEP_E2E=1 CI=1 npx expo start --clear --host localhost --port "$METRO_PORT" > "$EXPO_LOG" 2>&1 &
fi
METRO_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${METRO_PORT}/status" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${METRO_PORT}/status" >/dev/null || { cat "$EXPO_LOG"; exit 1; }

log "Installing debug APK: $APK_PATH"
install_apk

log "Launching app"
adb_cmd shell am start -W -n "$APP_ACTIVITY" >/dev/null || adb_cmd shell monkey -p "$APP_ID" 1 >/dev/null
for _ in $(seq 1 150); do
  if grep -q "Android Bundled" "$EXPO_LOG"; then
    break
  fi
  sleep 1
done
grep -q "Android Bundled" "$EXPO_LOG" || { cat "$EXPO_LOG"; exit 1; }
sleep 8

open_route "library"
capture "01-library-loaded" "Local Org"

# Open the first sample document from the library.
adb_cmd shell input tap 260 245 || true
capture "02-document-opened" "open app workflow"

open_route "agenda"
capture "03-agenda" "Morning habit"

open_route "habits"
capture "04-habits" "Morning habit"

open_route "roam"
capture "05-roam-graph" "Roam Nodes"

log "Screenshots ready"
ls -lh "$SCREENSHOT_DIR"
