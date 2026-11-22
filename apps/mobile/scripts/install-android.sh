#!/usr/bin/env bash
# Builds the release APK and installs it on the phone connected over USB (with USB debugging on).
#
#   pnpm --filter mobile android:install
#   apps/mobile/scripts/install-android.sh
#
# Several devices connected: pick one with ANDROID_SERIAL=<id from `adb devices`>.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE="com.borys.pushermessaging"
APK="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

fail() { echo "error: $*" >&2; exit 1; }

command -v adb >/dev/null || fail "adb not found. Install Android SDK platform-tools into $ANDROID_HOME."

# Check for the phone before the build, so a missing cable doesn't cost a few minutes of Gradle.
mapfile -t devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  printf '%s\n' "${devices[@]}" | grep -qx "$ANDROID_SERIAL" || fail "device $ANDROID_SERIAL is not connected."
elif (( ${#devices[@]} == 0 )); then
  adb devices | grep -q unauthorized && fail "the phone is connected but not authorized: confirm \"Allow USB debugging\" on it."
  fail "no phone found. Connect it over USB and turn on USB debugging (Settings → Developer options)."
elif (( ${#devices[@]} > 1 )); then
  fail "several devices connected (${devices[*]}). Pick one: ANDROID_SERIAL=<id> $0"
else
  export ANDROID_SERIAL="${devices[0]}"
fi
echo "→ Device: $ANDROID_SERIAL ($(adb shell getprop ro.product.model | tr -d '\r'))"

# The API address is baked into the APK at build time.
api_url="$(grep -s '^EXPO_PUBLIC_API_URL=' "$APP_DIR/.env" | cut -d= -f2- || true)"
if [[ -z "$api_url" ]]; then
  echo "warning: EXPO_PUBLIC_API_URL is not set in apps/mobile/.env; the app will use http://10.0.2.2:3000, which only works in the emulator." >&2
else
  echo "→ API: $api_url"
fi

cd "$APP_DIR"
if [[ ! -d android ]]; then
  echo "→ android/ is missing, generating it from app.json"
  npx expo prebuild --platform android
fi

echo "→ Building the release APK"
(cd android && ./gradlew assembleRelease)

echo "→ Installing"
if ! output="$(adb install -r "$APK" 2>&1)"; then
  echo "$output" >&2
  if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE <<<"$output"; then
    fail "the app on the phone is signed with a different key. Remove it (this also clears the saved sign-in): adb uninstall $PACKAGE, then run this script again."
  fi
  fail "adb install failed."
fi

echo "→ Launching"
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
echo "✓ Installed on $ANDROID_SERIAL"
