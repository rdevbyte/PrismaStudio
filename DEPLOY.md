# Deploying TabulaMetrics

## Why it kept failing

There were **two** separate problems, and the second one is the reason it still failed after I fixed the config.

### 1. The old config pointed at a directory that doesn't exist

Your original `vercel.json` and `package.json` said:

```json
"buildCommand": "npm run build --workspace=frontend",
"outputDirectory": "frontend/dist",
"workspaces": ["frontend"]
```

There is no `frontend/` folder in the project. npm exits with `No workspaces found: --workspace=frontend`, the build fails, and Vercel shows an error page. Fixed.

### 2. The fix was never in your repo

**This is the one that mattered.** My changes were made in the Arena workspace sandbox — a different machine from your GitHub repo. Vercel deploys from GitHub, so it kept building your *old* code with the broken `--workspace=frontend` command. Nothing I changed here could affect your deploy until the code is actually pushed.

So: the files must be copied out of this workspace and pushed to your repo. Steps below.

---

## Which file do I use?

| File | What it is | Unzip? |
|---|---|---|
| **`dist/index.html`** | The finished app, one file | n/a — **use this one** |
| `TabulaMetrics.html` | Identical file, different name | n/a |
| `TabulaMetrics-SITE.zip` | Contains just `index.html` | Yes, if you want the folder |
| `TabulaMetrics-deploy.zip` | **Source code**, needs building | Yes, then `node build.js` |

**You do not need either zip.** They exist for convenience. The app is delivered as one
standalone HTML file — its analysis/runtime are inline, and Google Sans is an optional
Google Fonts resource with a local sans-serif fallback.

`TabulaMetrics-deploy.zip` is source only: it has no `dist/` inside, so if you
upload it to Vercel without running the build you get nothing to serve.

## Deploy (pick one)

### Option A — drag and drop, no git, ~30 seconds ← easiest

1. Download **`dist/index.html`**.
2. Put it alone in a folder (any name, e.g. `tabulametrics`).
   The file **must** be named `index.html` so Vercel serves it at `/`.
3. Go to **vercel.com/new** → drag the *folder* (not the file) onto the page.

Done. No repo, no build, no zip, no settings.

If you prefer, `TabulaMetrics-SITE.zip` already contains exactly that folder
layout — unzip it and drag the resulting folder.

### Option B — GitHub (proper setup)

1. Download the current source files from the workspace (or use `TabulaMetrics-deploy.zip`, which includes source, tests, lockfile, and documentation):

   ```
   src/             test/ (optional for deployment)
   build.js         serve.js
   package.json     package-lock.json
   vercel.json      .gitignore      .vercelignore
   README.md        PRIVACY.md      LEGAL-NOTES.md      DEPLOY.md
   ```

2. Replace the contents of your repo with them, then:

   ```bash
   git add -A
   git commit -m "TabulaMetrics v2: static build, fix Vercel deploy"
   git push
   ```

   **Delete the old `frontend` references** if any remain — especially `"workspaces"` in the root `package.json`.

3. Vercel auto-deploys on push.

### Option C — CLI from your own machine

```bash
npx vercel --prod
```

---

## ⚠️ Dashboard settings override `vercel.json`

If your first import saved Build & Output settings in the Vercel UI, **those win over the config file** and the old broken command will keep running no matter what I put in `vercel.json`.

Go to **Project → Settings → Build and Deployment → Build & Development Settings** and confirm:

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Build Command | *Override OFF* (or `node build.js`) |
| Output Directory | *Override OFF* (or `dist`) |
| Install Command | *Override OFF* (or `echo skip`) |
| Root Directory | **empty** ← if this says `frontend`, that alone breaks the deploy |

Any toggle showing **Override** in blue is ignoring `vercel.json`. Switch it off, then **Deployments → ⋯ → Redeploy** with *Use existing Build Cache* **unchecked**.

---

## What the config now does

```json
{
  "framework": null,
  "installCommand": "echo 'no dependencies required'",
  "buildCommand": "node build.js",
  "outputDirectory": "dist"
}
```

The static app build uses **no npm runtime dependencies** — `build.js` is plain Node that concatenates `src/` into one HTML file. Vercel's `installCommand` skips package installation, so the browser-test dependency and browser are not downloaded during deployment. `playwright` is pinned as a development dependency for the local UI/animation test suites only.

The current build was verified locally:

```
--- build ---    Built: 565 KB → dist/index.html + TabulaMetrics.html
--- app file --- approximately 565 KiB
--- runtime ---  no external scripts, APIs, or analytics required
```

---

## Troubleshooting

**"No Output Directory named 'dist' found"**
The build didn't run. Check the deploy log for the Build step — if it says `--workspace=frontend`, the dashboard is overriding the config (see above) or the old code is still on the branch.

**404 NOT_FOUND on the live URL**
Output Directory is wrong, or Root Directory is set to `frontend`. Both are in Settings → Build and Deployment.

**Build succeeds but page is blank**
Check the browser console and confirm `dist/index.html` is roughly 565 KiB, not a few hundred bytes. The app does not need external scripts or APIs at runtime. If you use a hosted copy, the browser still makes the normal request to the host for the page; host-side request logging is separate from app data processing.

**Deploy is slow or times out**
Make sure `.vercelignore` is present. Without it, Vercel uploads `node_modules`, `.cache` (554 MB) and screenshots.

---

## No hosting needed

`TabulaMetrics.html` bundles its CSS, JavaScript, analysis worker, and GSAP. Google Sans is fetched from Google Fonts when online; if the font service is unreachable or you open the app offline, its system sans-serif fallbacks keep the app usable. You can email it, place it on a shared drive, or open it from a USB stick. When hosted, the browser requests the page from that host, and Google may receive ordinary metadata for font requests; neither request includes spreadsheet contents or analysis results. The app does not upload the spreadsheet during ordinary use. See `PRIVACY.md` for the distinction.
