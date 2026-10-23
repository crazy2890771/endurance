# Deployment: GitHub + Cloudflare Pages

KIM ENDURANCE LAB is a static single-page app. `npm run build` writes everything to `dist/`, including the service worker and the web manifest.

## 1. GitHub

Push the repository to GitHub. The included workflow `.github/workflows/ci.yml` runs the type-check, the tests and the build on every push and pull request.

## 2. Cloudflare Pages

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git**, then pick this repository.
2. Build settings:
   | Setting | Value |
   | --- | --- |
   | Framework preset | None (or Vite) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `/` |
   | Environment variable | `NODE_VERSION` = `22` |
3. Optional, to pre-configure cloud sync for every user of this deployment, add:
   - `VITE_SUPABASE_URL`: `https://<project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: the project's **anon / public** key

   Both values are public by design: they end up in the browser bundle, and Row Level Security protects the data. **Never** set a `service_role` key. If you leave these unset, each user can enter their own project under **Settings → Cloud Sync**.
4. Save and deploy. Each push to the production branch redeploys, and other branches get preview URLs.

### SPA routing

The project ships no `404.html`, so Cloudflare Pages serves `index.html` for unknown paths and deep links such as `/planner` work. Offline, the service worker answers navigations with the cached `index.html`.

### Updates

The service worker uses a *prompt* strategy. After a new deploy, users see "A new version is available → Update" the next time they open the app. Data in IndexedDB is not touched by updates.

## 3. Install on iPhone

Open the site in Safari, tap **Share → Add to Home Screen** and launch it from the icon. It runs standalone with safe-area insets and works offline.

## 4. Supabase redirect URL (only when using sync)

In Supabase go to **Authentication → URL Configuration** and add your Pages domain, for example `https://kim-endurance-lab.pages.dev`, plus any custom domain, under *Redirect URLs*. The sign-in link returns to `/settings/sync`.
