# Changelog

Each build shows its version and commit on the splash screen, under **Settings → About**, and at `/version.json`.

## 1.2.2 — 2026-10-26
- Splash screen shortened from 3 to 1.5 seconds.

## 1.2.1 — 2026-10-26
- AIMS DM1–DM4 codes import as **Standby** (AIMS counts them as standby days), like DH.
- Standby is "Training OK" by default: call-outs are rare, so workouts on standby days get no conflict warnings. Change it under Settings → Duty Types.
- Existing data is updated once on launch: standby becomes Training OK unless you changed it yourself, and DM duties imported from AIMS move to Standby.

## 1.2.0 — 2026-10-26
- Upload the AIMS Personal Crew Schedule Report PDF straight into KIM. It is read on the device (works offline, no AI): flights with every sector, report/sign-off, delays, overnight duties, deadhead sectors, DM/DH ground duties, OFF/ROFF/REST/AL. Older duties on the same dates are replaced; workouts are untouched.
- PDF reading uses pdf.js's legacy build so it also runs on iPhone Safari.
- Planner says "No workout planned" instead of "Rest day" on duty days without a workout.

## 1.1.1 — 2026-10-26
- Version bump to confirm automatic Cloudflare deploys from GitHub pushes.

## 1.1.0 — 2026-10-26
- Opens straight into the app after a 3-second splash; no Get Started screen. Language follows the device on first launch.
- Version, commit and build time on the splash and in Settings → About; `/version.json` for checking the live build.
- Import rosters from the ตารางแลกไฟลต์ app (AIMS JSON), with an option to replace existing duties on the imported dates.
- Deploys as a Cloudflare Worker with static assets (`wrangler.jsonc`).

## 1.0.0 — 2026-10-23
- First release: home, weekly/monthly planner, workout wizard, duty calendar with CSV/ICS/PDF import, training-rule warnings, history, offline storage, backup/export, optional Supabase sync, Thai/English.
