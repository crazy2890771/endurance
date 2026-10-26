# Changelog

Each build shows its version and commit on the splash screen, under **Settings → About**, and at `/version.json`.

## 1.1.1 — 2026-10-26
- Version bump to confirm automatic Cloudflare deploys from GitHub pushes.

## 1.1.0 — 2026-10-26
- Opens straight into the app after a 3-second splash; no Get Started screen. Language follows the device on first launch.
- Version, commit and build time on the splash and in Settings → About; `/version.json` for checking the live build.
- Import rosters from the ตารางแลกไฟลต์ app (AIMS JSON), with an option to replace existing duties on the imported dates.
- Deploys as a Cloudflare Worker with static assets (`wrangler.jsonc`).

## 1.0.0 — 2026-10-23
- First release: home, weekly/monthly planner, workout wizard, duty calendar with CSV/ICS/PDF import, training-rule warnings, history, offline storage, backup/export, optional Supabase sync, Thai/English.
