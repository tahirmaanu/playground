# Clinic Patient History (Ikseeri Dar-ul-Ilaj)

Android app for Dawakhana Hakeem Ameer Muawiya & Hijama Clinic. Urdu / RTL, fully offline,
data kept in a local SQLite database on the phone.

Rebuilt from the original `app-debug.apk` (a Capacitor app whose web layer was readable inside the APK).

## Features
- **Home**: today's patient count, today's income, pending balance
- **Add record**: record no. (auto, starts at 5000), name, phone, age, disease, symptoms, pulse, hijama, prescription, Perhaiz (diet) picker, fee / paid; auto visit number; previous-history side panel
- **Search**: by record no., name or phone; per-patient ledger (fee, paid, running balance, previous/new Rx); add new visit, edit, delete
- **Settings**: WhatsApp auto-open after save, JSON backup, merge-restore, delete-all (safety backup first)
- **Overview (new)**: *All patients* list (visits, last visit, fee/paid/balance; sort + filter) and *recent visits log* for the last 7 / 30 / 90 days grouped by day with daily totals; tap any row to open that patient's full history

## Layout
- `www/` – the app UI (`index.html`, `local-sqlite.js`)
- `android/` – Capacitor Android project; `PatientFileStoragePlugin.java` handles backup save/pick and opening WhatsApp
- `reference/original-index.html` – UI exactly as recovered from the original APK

## Build
```
npm install
export ANDROID_HOME=/path/to/android-sdk
npx cap sync android
cd android && ./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```
