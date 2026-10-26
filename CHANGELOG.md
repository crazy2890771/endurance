# Changelog

Each build shows its version and commit on the splash screen, under **Settings → About**, and at `/version.json`.

## 1.8.0 — 2026-10-26
- **See free time at a glance.** The month calendar marks each rostered day: green = free all day (OFF, ROFF, Rest, AL, Standby), amber = free between duties, red = no free time. A legend sits under the calendar, and tapping a day lists its free windows.
- The week view shows the free windows on duty days (e.g. "Free 05:00–14:20") instead of "No workout planned", and "Free all day" on off days.
- Thai: workout names read naturally ("วิ่งเบา", "วิ่งอินเทอร์วัล") and durations are in Thai ("45 นาที", "1 ชม. 40 นาที").

## 1.7.0 — 2026-10-26
- A duty that runs past midnight (e.g. report 15:20, debrief 01:12) belongs to its report day only. The next day is no longer shown as a flight day: it shows as **OFF** with "Train after …", and workouts are fine once the duty has ended plus **8 hours** of rest (09:12 in that example).
- Planning inside that rest period raises a "Rest after FLT until …" warning; the editor shows the rest end and offers free windows from then. The rest length is adjustable under Training Rules → Duty conflicts.
- AIMS import adds an OFF day for dates that only finish the previous night's duty.

## 1.6.0 — 2026-10-26
- Weeks now run **Sunday–Saturday** (existing installs switch once; change it under Settings → Units, Language & Theme).
- New weekly limit: at most **1 long run, 1 interval and 1 tempo** per week, each counted on its own (any activity for interval/tempo). It replaces the old long-runs-per-week rule and can be adjusted under Training Rules.

## 1.5.0 — 2026-10-26
- Uploading an updated AIMS roster compares it with the stored one day by day. On days whose duty changed (type, times or route), planned workouts are removed because they were planned around the old duty. Days that didn't change keep their plan, and completed or skipped workouts are always kept.
- The review screen lists the changed days and the workouts that will be removed before you save, and the confirmation has **Undo**.

## 1.4.0 — 2026-10-26
- Flight days: plan workouts freely as long as they don't clash with the duty. When adding a workout on a duty day, the editor shows the duty, flags a clashing start time immediately (duty ± buffer from Training Rules), and offers the free windows as one-tap start times.
- "Limited" duty types now read as "Outside duty time".

## 1.3.3 — 2026-10-26
- Version and commit now show at the top of Settings and at the bottom of Home, in addition to the splash and Settings → About.

## 1.3.2 — 2026-10-26
- Import roster now offers only **Upload AIMS roster (PDF)**. CSV, ICS, other-PDF and JSON options were removed from the screen. A PDF that isn't an AIMS report gets a clear message.

## 1.3.1 — 2026-10-26
- Fix AIMS PDF upload on iPhone Safari ("undefined is not a function"): page text is now read without async stream iteration, and the missing browser features pdf.js needs (stream async iteration, `Promise.withResolvers`) are filled in when absent.

## 1.3.0 — 2026-10-26
- Renamed to **KIM · Ground Time** ("Your free time, planned"). The home-screen icon is labelled *Ground Time*. Data, backups and links carry over unchanged.

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
