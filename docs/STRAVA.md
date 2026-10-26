# Strava (results from Garmin)

Garmin Connect → Strava → this app. The app only **reads** activities; it never posts to Strava.

## How it works

- `worker/index.ts` (the Cloudflare Worker) handles `/api/strava/*`. Everything else is the static app.
- Sign-in uses Strava OAuth with the `read,activity:read_all` scope. The client secret stays in Cloudflare.
- After sign-in the Worker encrypts the Strava tokens (AES-GCM, key derived from the client secret) and hands the app that opaque string. The app keeps it on the device and sends it back as a Bearer token; nothing is stored on the server. The Worker refreshes expired tokens and returns the new sealed string.
- **Settings → Strava → Get recent activities** pulls activities since the last sync (first time: 30 days). Each one is matched to a planned workout of the same activity on the same day (closest start time first). You review the list, untick anything, and save. Matched workouts are marked completed with time, distance, average HR and pace; unmatched ones are added as completed workouts. RPE is left for you. Undo is available, and an activity is never imported twice.
- Strava sports map to: Run/TrailRun/VirtualRun → run, Ride/VirtualRide/GravelRide/MountainBikeRide/EBikeRide → cycle, Swim → swim, WeightTraining/Workout/Crossfit → strength. Others (walks, hikes…) are skipped.

## Setup (once)

1. Go to <https://www.strava.com/settings/api> and create an app. Any name; *Website* = the app's URL.
2. *Authorization Callback Domain*: the app's host only, e.g. `endurance.<your-subdomain>.workers.dev` (no `https://`).
3. Cloudflare → Workers & Pages → **endurance** → Settings → **Variables and Secrets** → add, as type **Secret**:
   - `STRAVA_CLIENT_ID`: the Client ID from Strava
   - `STRAVA_CLIENT_SECRET`: the Client Secret from Strava
4. Redeploy (or push any commit). **Settings → Strava** then shows *Connect with Strava*.

A new Strava API app allows one connected athlete (its owner), which is exactly the single-user case and keeps others out.

## iPhone Home Screen app

A Home Screen web app keeps its own storage, separate from Safari. Connect from inside the Home Screen app. If the Strava sign-in ends up in Safari instead, use **Copy code** there and paste it in the Home Screen app under **Settings → Strava → Have a connection code?**

## Local testing

`npx wrangler dev` with a `.dev.vars` file (git-ignored) containing `STRAVA_CLIENT_ID=…` and `STRAVA_CLIENT_SECRET=…`. Add `localhost` as the callback domain in the Strava app to sign in locally.
