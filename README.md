# KIM · Ground Time

*Your free time, planned.* (Formerly KIM Endurance Lab.)

A mobile-first, offline-capable Progressive Web App for planning running, cycling, swimming and strength training around an irregular airline flight-duty roster.

- **Manual planning, no AI.** You plan every session yourself. The app never generates, recommends or reschedules workouts.
- **Duty-aware.** You enter or import your roster (CSV, ICS or PDF, always reviewed before saving), and each duty type says whether it allows training (yes, limited or no). Flight days default to *Limited*; standby (incl. AIMS DM/DH codes) defaults to *Training OK*.
- **Deterministic rule checks.** Configurable rules warn you about back-to-back hard days, short recovery, running streaks, missing rest, conflicts with duties (including overnight duties) and jumps in running volume. Warnings explain themselves and can be overridden. Nothing is changed automatically.
- **Offline first.** Everything is stored on the device in IndexedDB, and the app shell is precached by a service worker.
- **Optional cloud sync** through your own Supabase project. Without it the app is fully local and needs no login.
- **Thai and English**, metric or imperial units, dark (default), light or system theme.

## Tech stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 3 · Lucide icons · Dexie (IndexedDB) · vite-plugin-pwa (Workbox) · Supabase JS (lazy-loaded) · pdf.js (lazy-loaded) · Vitest

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (rules engine, importers, sync merge, DB repo, units, i18n)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build (service worker active)
```

Requires Node 20 or later.

On first launch you can tick **Load demo plan**. It fills six weeks around today with a realistic roster and workouts, every record notes "Demo data", and you can erase it under **Settings → Backup & Data**.

## Project structure

```
src/
  app/            App shell, routing, bottom nav, sheets/toasts/confirm context
  components/     Shared UI (Sheet, cards, icons, form controls)
  db/             Dexie schema, repository (CRUD), live-query hooks, backup, demo data
  domain/         Types, catalog (activities, types, defaults), rules engine, roster importers
  features/       home · planner · workout · duty · plancheck · history · settings · welcome
  i18n/           en.ts / th.ts dictionaries (th is type-checked to cover every key)
  lib/            dates, unit formatting
  sync/           Supabase sync engine + pure merge logic
supabase/schema.sql   Optional cloud table + RLS + last-write-wins trigger
tests/                Vitest suites
docs/                 Deployment and Supabase guides
```

## Features

| Area | Details |
| --- | --- |
| Home | Date, today's duty, today's workout with Complete button, plan-check status, weekly progress, run/ride/swim totals, upcoming 7 days, quick add |
| Planner | Week view (default) and month view, swipe or arrows to change week, today highlighted, duty badges, multiple workouts per day, rest days, plan-check badge, FAB |
| Workouts | 3-step wizard (activity → type and location → details: date, start time, duration, distance, HR zone, target, interval sets, notes), save as template, edit, delete with undo, duplicate to a date, move to a date or tap a day in the planner, reorder within a day, complete with actual results, skip, reopen |
| Duties | Flight, Standby, DM, AL, ROFF, Rest, OFF and custom types. Start/end times, overnight and multi-day duties, CSV/ICS/PDF import with a review screen and duplicate detection |
| Rules | 7 rules, each with an on/off switch and a threshold. Warnings show an explanation and *Adjust* / *Override* actions |
| History | Week/month/year: distance, time, completed vs due, consistency %, average RPE, activity breakdown, running distance chart, completed list |
| Settings | Duty calendar and import, duty types, training rules, HR zones, templates, units/language/theme/week start, backup (JSON) and CSV export, restore, demo data, erase, cloud sync, install |

### Roster import formats

- **CSV**: a header row with any of `date, duty, start, end, end date, title, notes` (common synonyms are accepted), or no header in the order `date, duty, start, end, notes`. Dates may be `2026-10-21`, `21/10/2026`, `21OCT26` or `21 Oct 2026`; times `0630` or `06:30`. A template can be downloaded from the import screen.
- **ICS**: standard VEVENTs. UTC times are converted to the device time zone, all-day events become multi-day duties, and the UID is used to detect duplicates.
- **AIMS PDF** (Personal Crew Schedule Report): read precisely from the report's grid on the device: report/sign-off (bold), sectors, delays, overnight `→`/`↓` duties, `*` deadhead, ground codes and free days. Re-uploading replaces older duties on those dates.
- **Other PDFs**: best-effort text extraction with pdf.js. Each text line that starts with a date becomes a candidate row. Airline PDFs vary a lot, so the review step is mandatory.

Duty codes are matched to duty types by code and by keywords that you can edit under **Duty Types**. Rows that match nothing stay unticked until you choose a type.

### Training rules (defaults)

| Rule | Default |
| --- | --- |
| Consecutive hard days (intervals, tempo, Zone 4–5, long run, lower/full-body strength) | max 1 |
| Recovery between high-intensity sessions | 48 h |
| Consecutive running days | max 3 |
| Rest days per week | min 1 |
| Duty conflict buffer before and after a timed duty | 60 min |
| Weekly running-distance increase (only when the previous week is at least 10 km) | max +10% |
| Long runs per week | max 1 |

If a workout or its duty has no times, a *Limited* duty raises an information notice, and a *No training* duty raises a warning. The engine is a pure function (`src/domain/rules.ts`) covered by `tests/rules.test.ts`.

## Data, offline and sync

- All data lives in IndexedDB on the device. The app asks for persistent storage, and **Settings → Backup & Data** shows whether the browser granted it.
- Deletions are soft (tombstones), so they can sync and be undone.
- The service worker precaches the whole app, including the PDF worker, so it opens and works with no network. A banner shows when you are offline, and an *Update* prompt appears when a new version is deployed.
- **Cloud sync is optional.** See [docs/SUPABASE.md](docs/SUPABASE.md). Until you configure it, the Sync screen says **Not configured**. The app never pretends to sync.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for GitHub + Cloudflare Pages.

## Regenerating icons

`public/icons/*.png` are rendered from the SVGs with Playwright/Chromium:

```bash
node scripts/gen-icons.mjs   # needs the `playwright` package available
```
