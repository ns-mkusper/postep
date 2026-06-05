#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

adb wait-for-device
for _ in $(seq 1 60); do
  if adb shell cmd package list packages >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
sleep 120
adb reverse tcp:8081 tcp:8081
EXPO_PUBLIC_POSTEP_E2E=1 CI=1 npx expo start --clear --host localhost > /tmp/postep-expo.log 2>&1 &
METRO_PID=$!
cleanup() {
  kill "$METRO_PID" >/dev/null 2>&1 || true
  cat /tmp/postep-expo.log || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8081/status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8081/status || { cat /tmp/postep-expo.log; exit 1; }

for attempt in 1 2 3; do
  if timeout 300s npm run e2e:android:install; then
    break
  fi
  adb kill-server || true
  adb start-server || true
  adb wait-for-device
  sleep 30
  if [ "$attempt" = "3" ]; then
    exit 1
  fi
done
adb shell monkey -p com.postep.mobile 1
for _ in $(seq 1 150); do
  if grep -q "Android Bundled" /tmp/postep-expo.log; then
    break
  fi
  sleep 1
done
grep -q "Android Bundled" /tmp/postep-expo.log || { cat /tmp/postep-expo.log; exit 1; }
sleep 15
timeout 120s maestro test e2e/maestro
