# Clinic Patient History (Ikseeri Dar-ul-Ilaj)

Android app for Dawakhana Hakeem Ameer Muawiya & Hijama Clinic. Urdu / RTL, fully offline,
data kept in a local SQLite database on the phone.

Rebuilt from the original `app-debug.apk` (a Capacitor app whose web layer was readable inside the APK).

## Features
- **Home**: today's patient count, today's income, pending balance
- **Add record**: record no. (auto, starts at 5000), name, phone, age, disease, symptoms, pulse, hijama, prescription, Perhaiz (diet) picker, fee / paid; auto visit number; previous-history side panel
- **Search**: by record no., name or phone; per-patient ledger (fee, paid, running balance, previous/new Rx); add new visit, edit, delete
- **Settings**: WhatsApp auto-open after save, JSON backup, merge-restore, delete-all (safety backup first)
- **Back gesture / button**: swipe-back or the Android back button walks back one screen at a time (and closes pop-ups first); only back from Home leaves the app
- **Body chart**: front/back anatomy drawing - tap to add a point, drag to move it, pinch / +/- to zoom, tap a point to label (e.g. "18") or delete it, undo; saved with each visit and shown on the record
- **Follow-ups**: "next visit in N days" on each visit -> countdown badge per patient (green / amber / red), Android notification on the due date (time configurable), notification centre with New / Upcoming / Snoozed / Done tabs (mark read-unread, snooze 1-7 days or custom date, mark complete, WhatsApp reminder, open history)
- **WhatsApp message** after saving now includes the next-visit date
- **Overview**: *All patients* list (visits, last visit, fee/paid/balance; sort + filter) and *recent visits log* for the last 7 / 30 / 90 days grouped by day with daily totals; tap any row to open that patient's full history

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
