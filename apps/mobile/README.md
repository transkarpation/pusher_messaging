# Mobile app

Expo (React Native) client for the chat. Running it in development is described in the [root README](../../README.md#mobile-app). This file covers building an Android APK that you can install on a phone.

## Before any build

**API address.** `EXPO_PUBLIC_API_URL` is baked into the app at build time. Without it the app uses `http://10.0.2.2:3000`, which works only in the Android emulator. Set it to an address the phone can reach, e.g. your computer's LAN IP:

```sh
cp .env.example .env
# .env
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

Rebuild the APK after changing it.

**Plain HTTP.** Release builds of Android block `http://` by default. `app.json` turns it back on with the `expo-build-properties` plugin (`android.usesCleartextTraffic: true`), so the app can talk to the API over HTTP. If the API is served over HTTPS, this option can be removed.

The Android package name is `com.borys.pushermessaging` (`android.package` in `app.json`).

## Local build

Requirements:

- **JDK 17**, e.g. `sudo apt install openjdk-17-jdk`
- **Android SDK** with Android SDK Platform 36 (Android Studio installs it to `~/Android/Sdk`). Gradle downloads missing SDK parts on its own once the licenses are accepted (`sdkmanager --licenses`).
- Environment variables, e.g. in `~/.bashrc`:

  ```sh
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  export ANDROID_HOME=$HOME/Android/Sdk
  export PATH=$PATH:$ANDROID_HOME/platform-tools
  ```

Build:

```sh
cd apps/mobile
npx expo prebuild --platform android   # generates android/ from app.json (gitignored)
cd android
./gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`. Install it with `adb install` or copy it to the phone.

To build and launch it on a connected device or emulator in one step, run `npx expo run:android --variant release` instead.

Notes:

- `android/` is generated. Don't edit it by hand: change `app.json` or a config plugin, then run `npx expo prebuild --clean` to regenerate it.
- The release build is signed with the debug keystore of the generated project. That's enough to install it on your own devices, but Google Play needs your own upload key.
- The first build takes a while because Gradle downloads its dependencies.

## Cloud build with EAS

No local JDK or Android SDK is needed. You need a free Expo account.

```sh
npm install --global eas-cli
eas login
cd apps/mobile
eas build:configure      # creates eas.json and links the project to Expo
```

Add a profile that produces an APK to `eas.json`:

```json
{
  "build": {
    "preview": {
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "http://192.168.1.20:3000" }
    }
  }
}
```

```sh
eas build -p android --profile preview
```

EAS prints a link to the finished APK.

`.env` is not available to EAS builds, because they run on Expo's servers. Set the API address in the profile's `env` (as above, committed with `eas.json`) or as an EAS environment variable:

```sh
eas env:set --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment preview --visibility plaintext
```

and add `"environment": "preview"` to the profile.
