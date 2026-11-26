# Permanent-free production setup

This setup uses only services with a permanent free tier. **No account has been created and nothing has been deployed yet**, so there are no live URLs until you finish the steps below.

| Piece | Free service | Notes |
| --- | --- | --- |
| Frontend | **Cloudflare Pages** | Static React/Vite build. No server-side rewrites. |
| Backend + Socket.IO | **Render Free Web Service** | `render.yaml` already points to it. Sleeps when idle. |
| PostgreSQL | **Neon Free** | The repo uses PostgreSQL, not MongoDB. Render's free DB expires after 30 days; Neon's does not. |
| Uploads | **Cloudinary Free** | Render's disk is temporary, so uploads must live in the cloud. |
| Email | **Brevo Free HTTP API** | No SMTP ports and no Vercel mail relay. Sender must be verified. |
| Keep-awake | **UptimeRobot Free** (or cron-job.org) | Pings `/api/health` so Render wakes before a user arrives. |

After deployment, fill in these three URLs:

- **Frontend:** `https://<your-project>.pages.dev` (or your custom domain)
- **Backend API:** `https://<your-service>.onrender.com`
- **Health check:** `https://<your-service>.onrender.com/api/health`

### Checks already run on the prepared code

- `frontend`: `npm ci`; production build with `SKIP_FULL_WASM=1` and sample `VITE_*` values — passed; `dist/stockfish.wasm` is absent.
- `backend`: `npm ci`; `npm start` and `GET /api/health` — passed; bootstrap applies the schema plus 95 existing migrations in 3 passes.
- `npm run test:registration-email` — 12/12 passed.
- `npm run test:rematch-delivery` — 15/15 passed.
- `npm run test:enginepool` — 5/5 passed; `npm run test:wasmload` — 6/6 passed.
- Two suites already fail on the untouched original commit too, so they were left alone: `npm run test:certificates` (stale expectations about phone numbering/title text/template format) and `npm run test:reviewengine` (its temp copy omits `config/brand`, so Node cannot resolve an import).
- `npm audit` findings are unchanged; no `npm audit fix --force` was used.

---

## 1. Prepare the code on your computer

Use Node **20** (the repo now pins it with `.nvmrc` and `engines`).

The prepared changes are in your local working tree and have **not** been committed or pushed. If you want to deploy from GitHub, publish them first:

```powershell
cd 'C:\Users\MANIVEL M\AppData\Local\Temp\opencode\mate-zone-fresh'
git add -A
git commit -m "Prepare permanent-free Cloudflare/Render/Neon deployment"
git push origin main
```

If you built locally first, the two generated worker files can show line-ending-only changes. Restore them before committing:

```powershell
git restore -- frontend/public/stockfish.js frontend/public/stockfish-lite.js
```

Then use a fresh clone (or continue in that folder):

```bash
git clone https://github.com/coachvikke-arch/chess-app.git
cd chess-app

cd frontend
npm ci
cd ..

cd backend
npm ci
cp .env.example .env
cd ..
cp frontend/.env.example frontend/.env
```

`cd frontend && npm ci` is important: it generates the Stockfish worker files and puts the full 99 MB review network in `frontend/node_modules`. It is **not** committed to Git and must never be uploaded to Cloudflare Pages.

---

## 2. Neon — free PostgreSQL

1. Go to https://neon.com and sign up with GitHub (no card).
2. Create a project named `mate-zone` in a region near you.
3. Open **Connection Details** and copy the pooled connection string. It looks like:
   `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`
4. Paste that string into `backend/.env` as `DATABASE_URL` for local commands, and keep it ready for Render.

Do not reuse any old Neon string from a previous deployment.

---

## 3. Cloudinary — free uploads

1. Go to https://cloudinary.com and sign up (free forever, no card).
2. From the Console dashboard copy:
   - **Cloud Name** → `CLOUDINARY_CLOUD_NAME`
   - **API Key** → `CLOUDINARY_API_KEY`
   - **API Secret** → `CLOUDINARY_API_SECRET`
3. Optional: set `CLOUDINARY_FOLDER=mate-zone` to keep all app uploads together.
4. Put those values in `backend/.env` and later in Render.

The app falls back to local disk when these are missing, which is fine on your computer but **not** on Render (the disk is temporary).

---

## 4. Brevo — free email

1. Go to https://www.brevo.com and sign up (free, no card).
2. Create an API key: **API keys → Generate a new API key** → `BREVO_API_KEY`.
3. Register the address you will send from: **Senders & Domains → Sender addresses → Add a new sender**. Use the same address for `MAIL_FROM_EMAIL`, then click the confirmation email Brevo sends. Until that address is verified, Brevo will reject mail.
4. Put these in `backend/.env` and later in Render:

```text
BREVO_API_KEY=your-brevo-key
MAIL_FROM_EMAIL=verified-sender@example.com
MAIL_FROM_NAME=MATE ZONE Chess Academy
```

Test it locally (sends a real email):

```bash
cd backend
npm run test:mail -- you@example.com
```

For a content-only test that prints instead of sending, add `MAIL_TRANSPORT=dummy` to `backend/.env` first.

---

## 5. Render — free backend

1. Go to https://render.com and sign up with GitHub (free services need no card).
2. **New → Blueprint** → choose this repository and branch `main`.
3. Render reads `render.yaml`. Its build command is `npm ci && node scripts/bootstrapDb.js`, which creates the schema and runs the existing migrations on first boot.
4. Fill in the secret values when prompted. The required ones are:

| Render variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon string from step 2 |
| `CLIENT_URL` | Your Cloudflare Pages URL, plus any preview URLs you want to allow (comma-separated) |
| `FRONTEND_URL` | Same Cloudflare Pages production URL (used in emails) |
| `BREVO_API_KEY` | From step 4 |
| `MAIL_FROM_EMAIL` | Verified Brevo sender |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | From step 3 |

`JWT_SECRET` is generated automatically by the blueprint. LiveKit variables are optional.

5. Click **Apply**. When it is live, open:

```text
https://<your-service>.onrender.com/api/health
```

You should see `{"status":"ok"}`.

Render free details: **750 instance-hours/month**, **0.1 CPU / 512 MB**, sleeps after **15 minutes** idle, first request after sleep takes about **1 minute**, and the disk is temporary. Render documents the free plan as unsuitable for production; this setup is free precisely because uploads, the database and email are external.

---

## 6. Cloudflare Pages — free frontend

1. Go to https://pages.cloudflare.com and sign up (free, no card).
2. **Create a project → Connect to Git** → choose this repository.
3. Build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `Vite` |
| Build command | `npm run build` (run from `frontend/`) |
| Build output directory | `dist` |
| Root directory | `frontend` |
| Node version | `20` (`NODE_VERSION=20`) |

4. Add these **build environment variables**:

| Cloudflare variable | Value |
| --- | --- |
| `NODE_VERSION` | `20` |
| `VITE_API_URL` | `https://<your-service>.onrender.com` (no `/api`) |
| `VITE_SOCKET_URL` | `https://<your-service>.onrender.com` |
| `VITE_UPLOAD_BASE_URL` | `https://<your-service>.onrender.com` (only for old `/uploads/...` rows) |
| `VITE_REVIEW_WASM_URL` | The Cloudinary secure URL from step 7 |
| `SKIP_FULL_WASM` | `1` |

`npm run build` automatically runs `prebuild` first, which re-copies the Stockfish workers and removes a stale `public/stockfish.wasm`. `SKIP_FULL_WASM=1` is what keeps the 99 MB WASM out of the Pages build. Cloudflare allows only **25 MiB per asset**, and the full network is about **94.6 MiB**. The small lite engine (~1.8 MB) still ships normally, so live analysis keeps working. A local verification build produced **116 files / 34.1 MB total**, largest asset **2.56 MB**, and no `stockfish.wasm`.

The repo already includes `frontend/public/_redirects` so React routes work on refresh, and `frontend/public/_headers` so the service worker does not go stale. There is no `vercel.json` and no mail relay any more.

5. Deploy. Your site will be at `https://<your-project>.pages.dev`.

`VITE_*` values are baked into the JavaScript at **build time**. After changing one, rebuild/redeploy the Pages project.

`VITE_UPLOAD_BASE_URL` only helps when the backend still has the old local file. Files that lived on a previous host's temporary disk must be re-uploaded (or migrated to Cloudinary); the variable cannot recreate them.

---

## 7. Upload the full review engine once

Cloudinary's normal upload endpoint rejects files over 100 MB, so the script uses chunked upload. From your local clone:

```bash
cd frontend
npm ci
cd ../backend
npm run upload:review-wasm
```

It prints a `secure_url`. Paste that entire URL into Cloudflare **Environment variables → VITE_REVIEW_WASM_URL**, then rebuild the Pages project.

The browser fetches this file from its own origin, so the URL **must allow CORS**. Cloudinary normally serves public assets with `Access-Control-Allow-Origin: *`. After uploading, open the URL in a browser and check the response headers; if CORS is missing, enable it in Cloudinary Console → Settings → Web Delivery / Security, or host the file somewhere that sends `Access-Control-Allow-Origin: *`. The worker reads bytes with `fetch(...).arrayBuffer()`, so the exact `Content-Type` is not critical.

This file is about **99 MB**, so it uses roughly **0.1 of Cloudinary's 25 monthly credits** for storage, and about **0.1 credit per full download**. That is why it is not bundled with every page load.

---

## 8. Keep Render awake

Use https://uptimerobot.com (free) or https://cron-job.org (free):

- Monitor type: **HTTP(S)**
- URL: `https://<your-service>.onrender.com/api/health`
- Interval: **10 minutes** (5 minutes is the free minimum; 10–14 is enough)
- Leave the expected status as `200`

This is optional but removes most of the ~1 minute cold start for real users.

---

## 9. Create the first super admin

Run this **once**, from your computer, using the Neon `DATABASE_URL`:

```bash
cd backend
npm ci
node scripts/create-super-admin.js --email owner@yourdomain.com --password 'choose-a-strong-password' --name "Academy Owner"
```

Do not put that password in a file, chat, or screenshot. The database stores only its hash.

---

## 10. Verify everything

```bash
# Backend is awake and connected
curl https://<your-service>.onrender.com/api/health

# Email really goes through Brevo
cd backend && npm run test:mail -- you@example.com

# CORS accepts the Pages origin when the reply contains Access-Control-Allow-Origin
curl -i -H "Origin: https://<your-project>.pages.dev" https://<your-service>.onrender.com/api/health
```

In the browser, sign in, upload a profile photo, open chat and attach a file, then open Game Review. In Render logs you should see:

```text
[mail] Brevo HTTP API ready as ...
[upload] Cloudinary ready (cloud ...)
```

If Game Review says the engine failed to boot, check `VITE_REVIEW_WASM_URL`, rebuild Pages, and open the URL directly in a browser to confirm it returns the 99 MB file.

---

## Environment variable reference

### Cloudflare Pages (frontend build)

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_VERSION` | yes | `20` |
| `VITE_API_URL` | yes | Render origin (no trailing `/api`) |
| `VITE_SOCKET_URL` | yes | Render origin |
| `VITE_UPLOAD_BASE_URL` | yes | Render origin, for legacy `/uploads/...` values |
| `VITE_REVIEW_WASM_URL` | yes | Direct Cloudinary/CORS URL for the full WASM |
| `SKIP_FULL_WASM` | yes | `1` |

### Render (backend)

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `NODE_VERSION` | yes | `20` |
| `PORT` | yes | `10000` (Render default) |
| `DATABASE_URL` | yes | Neon pooled string with `?sslmode=require` |
| `JWT_SECRET` | yes | Blueprint generates it; keep it secret |
| `JWT_EXPIRES_IN` | yes | `7d` |
| `CLIENT_URL` | yes | Exact Cloudflare origin(s), comma-separated |
| `FRONTEND_URL` | yes | Cloudflare production origin (emails use it) |
| `CORS_ORIGINS` | no | Alias for `CLIENT_URL`; only needed if you prefer that name |
| `BREVO_API_KEY` | yes | Brevo API key |
| `MAIL_TRANSPORT` | no | Local only: `dummy` prints mail instead of sending; leave unset on Render |
| `MAIL_FROM_EMAIL` | yes | Verified Brevo sender address |
| `MAIL_FROM_NAME` | yes | `MATE ZONE Chess Academy` |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | yes | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | no | `mate-zone` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | no | Leave empty unless you enable LiveKit |
| `ANALYSIS_ENGINE_POOL` | no | `1` |
| `GAME_HISTORY_RETENTION_DAYS`, `GAME_HISTORY_RUN_INTERVAL_MS` | no | Existing optional cleanup settings; leave empty for defaults |

### Neon

Only one variable is needed: `DATABASE_URL`. Use the same value in Render and for local admin/bootstrap commands. Never commit it.

### Cloudinary

`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, optional `CLOUDINARY_FOLDER`. Alternatively the SDK accepts a single `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>`.

### Brevo

`BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`. The sender address must be registered and confirmed in Brevo before mail is accepted.

---

## Honest free-tier limits

| Service | Permanent free limit | What it means here |
| --- | --- | --- |
| Cloudflare Pages | 500 builds/month, 20-minute build, 20,000 files, **25 MiB per asset** | The 99 MB review WASM cannot be a Pages asset; `SKIP_FULL_WASM=1` removes it from the build. |
| Render Free Web Service | 750 instance-hours/month, 0.1 CPU, 512 MB, sleep after 15 min idle, ~1 min cold start, temporary disk | One service fits. Uploads must be Cloudinary. Render labels this tier not for production. |
| Neon Free | 1 project, 1 GB storage, 100 compute-hours/month | Fine for a fresh academy; do not run heavy workers on this database constantly. |
| Cloudinary Free | 3 users per account, 25 credits/month, no card | 1 credit = 1 GB storage **or** 1 GB bandwidth **or** 1,000 transformations. Storage is current total; bandwidth/transformations reset over 30 days. The 99 MB engine is ~0.1 credit per full download. |
| Brevo Free | 300 emails/day after sender approval | Plenty for registrations. Sender verification is mandatory. |
| UptimeRobot Free | 50 monitors, 5-minute minimum interval | One monitor every 10 minutes keeps Render warm. |

No paid plan, trial, credit card, or old deployment credential is needed for any step.
