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
METRICS_DIR="${METRICS_DIR:-$(dirname "$SCREENSHOT_DIR")/android-performance}"
METRICS_JSON="${METRICS_JSON:-${METRICS_DIR}/metrics.json}"
ANDROID_STRICT_DOCUMENT_ASSERTIONS="${ANDROID_STRICT_DOCUMENT_ASSERTIONS:-0}"
ANDROID_ENFORCE_PERFORMANCE_BUDGETS="${ANDROID_ENFORCE_PERFORMANCE_BUDGETS:-0}"
ANDROID_BUDGET_ROUTE_MS="${ANDROID_BUDGET_ROUTE_MS:-15000}"
ANDROID_BUDGET_DOCUMENT_OPEN_MS="${ANDROID_BUDGET_DOCUMENT_OPEN_MS:-15000}"
ANDROID_BUDGET_ACTION_LABELS_MS="${ANDROID_BUDGET_ACTION_LABELS_MS:-15000}"
ANDROID_BUDGET_FOLD_TOGGLE_MS="${ANDROID_BUDGET_FOLD_TOGGLE_MS:-20000}"
ANDROID_BUDGET_SCROLL_MS="${ANDROID_BUDGET_SCROLL_MS:-4000}"
ANDROID_BUDGET_LAUNCH_BUNDLE_MS="${ANDROID_BUDGET_LAUNCH_BUNDLE_MS:-120000}"
mkdir -p "$SCREENSHOT_DIR" "$METRICS_DIR"
rm -f "$SCREENSHOT_DIR"/*.png "$METRICS_JSON"
declare -a METRIC_NAMES=()
declare -a METRIC_VALUES=()

log() {
  printf '[android-screenshots] %s\n' "$*"
}

now_ms() {
  date +%s%3N
}

record_metric() {
  local name="$1"
  local elapsed_ms="$2"
  METRIC_NAMES+=("$name")
  METRIC_VALUES+=("$elapsed_ms")
  log "metric ${name}=${elapsed_ms}ms"
}

write_metrics() {
  {
    printf '{\n  "metrics": ['
    for index in "${!METRIC_NAMES[@]}"; do
      if (( index > 0 )); then
        printf ','
      fi
      printf '\n    {"name":"%s","elapsedMs":%s}' "${METRIC_NAMES[$index]}" "${METRIC_VALUES[$index]}"
    done
    printf '\n  ]\n}\n'
  } > "$METRICS_JSON"
  log "Performance metrics ready: $METRICS_JSON"
}

measure_step() {
  local name="$1"
  local budget_ms="$2"
  shift 2
  local started_at
  local finished_at
  local elapsed_ms
  started_at="$(now_ms)"
  "$@"
  finished_at="$(now_ms)"
  elapsed_ms=$((finished_at - started_at))
  record_metric "$name" "$elapsed_ms"
  if [[ "$ANDROID_ENFORCE_PERFORMANCE_BUDGETS" == "1" && "$budget_ms" -gt 0 && "$elapsed_ms" -gt "$budget_ms" ]]; then
    log "Performance budget exceeded for $name: ${elapsed_ms}ms > ${budget_ms}ms"
    return 1
  fi
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
  write_metrics || true
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

window_xml() {
  adb_cmd shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || return 1
  adb_cmd exec-out cat /sdcard/window.xml || true
}

tap_xml_text() {
  local xml="$1"
  local label="$2"
  local node
  local bounds
  local x1 y1 x2 y2 x y

  node="$(grep -o "<node[^>]*text=\"${label}\"[^>]*>" <<<"$xml" | head -n 1 || true)"
  if [[ -z "$node" ]]; then
    node="$(grep -o "<node[^>]*content-desc=\"${label}\"[^>]*>" <<<"$xml" | head -n 1 || true)"
  fi
  if [[ -z "$node" ]]; then
    return 1
  fi

  bounds="$(sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' <<<"$node")"
  if [[ -z "$bounds" ]]; then
    return 1
  fi

  read -r x1 y1 x2 y2 <<<"$bounds"
  x=$(((x1 + x2) / 2))
  y=$(((y1 + y2) / 2))
  adb_cmd shell input tap "$x" "$y" || true
}

dismiss_system_dialogs() {
  local xml

  for _ in $(seq 1 3); do
    xml="$(window_xml || true)"
    if ! grep -Eiq "Pixel Launcher|Launcher3|nexuslauncher|isn.?t responding|Close app" <<<"$xml"; then
      return 0
    fi

    log "Dismissing Android system dialog before screenshot capture"
    tap_xml_text "$xml" "Wait" || \
      tap_xml_text "$xml" "OK" || \
      tap_xml_text "$xml" "Close app" || \
      adb_cmd shell input keyevent KEYCODE_ESCAPE || true
    sleep 1
  done
}

wait_for_text() {
  local timeout_seconds="$1"
  shift
  local expected_texts=("$@")
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local xml
    xml="$(window_xml || true)"
    if [[ -n "$xml" ]]; then
      dismiss_system_dialogs
      xml="$(window_xml || true)"
      for text in "${expected_texts[@]}"; do
        if grep -Fq "$text" <<<"$xml"; then
          return 0
        fi
      done
    fi
    sleep 2
  done

  log "Timed out waiting for text: ${expected_texts[*]}"
  window_xml || true
  return 1
}

wait_for_all_text() {
  local timeout_seconds="$1"
  shift
  local expected_texts=("$@")
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local xml
    local missing=0
    xml="$(window_xml || true)"
    if [[ -n "$xml" ]]; then
      dismiss_system_dialogs
      xml="$(window_xml || true)"
      for text in "${expected_texts[@]}"; do
        if ! grep -Fq "$text" <<<"$xml"; then
          missing=1
          break
        fi
      done
      if [[ "$missing" == "0" ]]; then
        return 0
      fi
    fi
    sleep 2
  done

  log "Timed out waiting for all text: ${expected_texts[*]}"
  window_xml || true
  return 1
}

capture() {
  local name="$1"
  shift
  wait_for_text 90 "$@"
  dismiss_system_dialogs
  sleep 2
  dismiss_system_dialogs
  adb_cmd exec-out screencap -p > "$SCREENSHOT_DIR/${name}.png"
  test -s "$SCREENSHOT_DIR/${name}.png"
  log "Captured $SCREENSHOT_DIR/${name}.png"
}

open_route() {
  local route="$1"
  log "Opening route: $route"
  dismiss_system_dialogs
  adb_cmd shell am start -W -a android.intent.action.VIEW -d "postep://$route" -p "$APP_ID" >/dev/null || \
    adb_cmd shell am start -W -a android.intent.action.VIEW -d "postep:///$route" -p "$APP_ID" >/dev/null || \
    adb_cmd shell monkey -p "$APP_ID" 1 >/dev/null
  sleep 4
  dismiss_system_dialogs
}

open_first_document() {
  local xml
  local node
  local bounds
  local x1 y1 x2 y2 x y

  xml="$(window_xml || true)"
  node="$(grep -o '<node[^>]*content-desc="E2E Org Sample [^"]*"[^>]*>' <<<"$xml" | head -n 1 || true)"
  if [[ -z "$node" ]]; then
    log "Could not find first document card in accessibility tree"
    window_xml || true
    return 1
  fi

  bounds="$(sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' <<<"$node")"
  if [[ -z "$bounds" ]]; then
    log "Could not read first document card bounds"
    return 1
  fi

  read -r x1 y1 x2 y2 <<<"$bounds"
  x=$(((x1 + x2) / 2))
  y=$(((y1 + y2) / 2))
  adb_cmd shell input tap "$x" "$y" || true
  wait_for_all_text 90 "More document actions" "open app workflow"
}

verify_document_actions() {
  wait_for_all_text 30 \
    "Cut selected item" \
    "Copy selected item" \
    "Paste item" \
    "Move selected item" \
    "More document actions" \
    "Archive or refile item" \
    "Schedule item" \
    "Set item deadline" \
    "Set item priority" \
    "Change item state" \
    "Create new item"
}

toggle_first_fold_control() {
  local xml

  xml="$(window_xml || true)"
  if ! grep -Fq "Collapse item" <<<"$xml"; then
    log "Fold control did not expose Collapse item"
    window_xml || true
    return 1
  fi

  tap_xml_text "$xml" "Collapse item"
  sleep 1
  xml="$(window_xml || true)"
  if ! grep -Fq "Expand item" <<<"$xml"; then
    log "Fold collapse did not expose Expand item"
    window_xml || true
    return 1
  fi

  tap_xml_text "$xml" "Expand item"
  sleep 1
  xml="$(window_xml || true)"
  if ! grep -Fq "Collapse item" <<<"$xml"; then
    log "Fold expand did not restore Collapse item"
    window_xml || true
    return 1
  fi
}

scroll_document_once() {
  adb_cmd shell input swipe 540 1550 540 760 250 || true
  sleep 1
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
launch_started_at="$(now_ms)"
adb_cmd shell am start -W -n "$APP_ACTIVITY" >/dev/null || adb_cmd shell monkey -p "$APP_ID" 1 >/dev/null
for _ in $(seq 1 150); do
  if grep -q "Android Bundled" "$EXPO_LOG"; then
    break
  fi
  sleep 1
done
grep -q "Android Bundled" "$EXPO_LOG" || { cat "$EXPO_LOG"; exit 1; }
sleep 8
launch_finished_at="$(now_ms)"
launch_elapsed_ms=$((launch_finished_at - launch_started_at))
record_metric "launch_bundle_ms" "$launch_elapsed_ms"
if [[ "$ANDROID_ENFORCE_PERFORMANCE_BUDGETS" == "1" && "$launch_elapsed_ms" -gt "$ANDROID_BUDGET_LAUNCH_BUNDLE_MS" ]]; then
  log "Performance budget exceeded for launch_bundle_ms: ${launch_elapsed_ms}ms > ${ANDROID_BUDGET_LAUNCH_BUNDLE_MS}ms"
  exit 1
fi

measure_step "open_library_ms" "$ANDROID_BUDGET_ROUTE_MS" open_route "library"
capture "01-library-loaded" "Local Org"

# Open the first sample document from the library.
measure_step "document_open_ms" "$ANDROID_BUDGET_DOCUMENT_OPEN_MS" open_first_document
if [[ "$ANDROID_STRICT_DOCUMENT_ASSERTIONS" == "1" ]]; then
  measure_step "document_action_labels_ms" "$ANDROID_BUDGET_ACTION_LABELS_MS" verify_document_actions
  measure_step "document_fold_toggle_ms" "$ANDROID_BUDGET_FOLD_TOGGLE_MS" toggle_first_fold_control
fi
capture "02-document-opened" "open app workflow"
if [[ "$ANDROID_STRICT_DOCUMENT_ASSERTIONS" == "1" ]]; then
  measure_step "document_scroll_ms" "$ANDROID_BUDGET_SCROLL_MS" scroll_document_once
fi

measure_step "open_agenda_ms" "$ANDROID_BUDGET_ROUTE_MS" open_route "agenda"
capture "03-agenda" "Morning habit"

measure_step "open_habits_ms" "$ANDROID_BUDGET_ROUTE_MS" open_route "habits"
capture "04-habits" "Morning habit"

measure_step "open_roam_ms" "$ANDROID_BUDGET_ROUTE_MS" open_route "roam"
capture "05-roam-graph" "Roam Nodes" "Knowledge Graph"

write_metrics
log "Screenshots ready"
ls -lh "$SCREENSHOT_DIR"
ls -lh "$METRICS_JSON"
