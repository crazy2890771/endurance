# Optional cloud sync with Supabase

The app works fully offline without this. Set up sync only if you want the same plan on several devices.

## Setup

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste [`supabase/schema.sql`](../supabase/schema.sql) and run it. It creates:
   - the table `public.kel_records`, with one row per workout, duty, duty type or template, stored as JSON;
   - Row Level Security policies, so each signed-in user can only read and write their own rows;
   - a trigger that enforces **last-write-wins**, so an older edit can never overwrite a newer one, and stamps a server-side cursor that clients use for incremental pulls.
3. In **Authentication → Providers** make sure **Email** is enabled. The app signs in with a magic link, so there are no passwords to store.
4. In **Authentication → URL Configuration** add the app URL, for example `https://your-app.pages.dev`, to *Redirect URLs*.
5. Copy **Project URL** and the **anon public** key from **Project Settings → API**.
6. In the app, open **Settings → Cloud Sync**, paste both values, then tap **Save connection**. Enter your email, tap **Send sign-in link**, and open the link on the same device. Repeat the sign-in on each device.

Alternatively, set the values at build time with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`).

> The app refuses a `service_role` key. Only the anon key belongs in a browser.

## How sync works

- IndexedDB stays the source of truth for the UI, and the cloud is a replica.
- Each record has an `updatedAt` timestamp and a local `dirty` flag. Sync runs on app start, when the device comes back online, when the app returns to the foreground, a few seconds after each edit and every 5 minutes. You can also tap **Sync now**.
- Each sync **pulls** rows changed on the server since the last cursor, merges them, then **pushes** local dirty rows.
- **Conflicts:** if the same record was edited on two devices before either synced, the newer edit wins and the other version is kept under **Cloud Sync → Sync conflicts**, where you can restore it. Nothing is discarded silently.
- Deletions sync as tombstones.
- Imported duties are de-duplicated locally, by date + type + times or by ICS UID, before they are ever pushed.

## Limitations (V1)

- Settings (language, units, rules, HR zones) are kept per device and are not synced.
- Pull uses a server timestamp cursor. With very heavy concurrent writes, a row committed out of order could be picked up one sync later. This does not cause data loss.
