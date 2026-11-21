# Lifetime-free backend deployment (Render + Neon)

This is the easiest permanently-free setup for this app:

| Piece | Free service | Why |
| --- | --- | --- |
| Express + Socket.IO | **Render Free Web Service** | Auto-deploys from GitHub, free HTTPS, no SSH/DNS |
| PostgreSQL | **Neon Free** | Permanent free plan (Render's free DB expires after 30 days) |
| Analysis worker | **GitHub Actions** (this public repo) | Free minutes; worker needs the full repo |
| Frontend | Vercel (already deployed) | `vercel.json` now rewrites `/api` and `/uploads` to Render |

Only the Render web service URL is `https://mate-zone-chess-api.onrender.com`.

## Trade-offs (important)

- **Sleeps after 15 minutes idle.** The first request after inactivity takes about
  a minute while Render boots the service. WebSocket clients reconnect.
- **Uploads are temporary.** Render's free filesystem is wiped on restart, so
  uploaded images disappear. No application code was changed for this.
- **Free DB is 1 GB** on Neon. Plenty for a fresh academy.
- Starting fresh means existing users/games are **not** recovered.

## Setup — what you do (about 5 minutes)

### 1. Neon (free Postgres)

1. Sign up at https://neon.com with GitHub (no card).
2. Create a project → name it `mate-zone` → region closest to you.
3. Neon creates a `neondb` database. In **Connection Details**, copy the
   connection string. It looks like:
   `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`
4. Send me that string (or paste it into Render in step 2).

### 2. Render (free web service)

1. Sign up at https://render.com with GitHub (no card needed for free services).
2. Dashboard → **New → Blueprint** → select this repository (`chess-app`),
   branch `main`.
3. Render reads `render.yaml`. When prompted, set:
   - `DATABASE_URL` = the Neon connection string from step 1.
   - Leave the other `sync: false` values empty unless you use LiveKit / mail relay.
4. Click **Apply**. Render builds, bootstraps the schema, and starts the API.

The service URL will be `https://mate-zone-chess-api.onrender.com`.

### 3. GitHub Actions secrets (worker + admin)

In GitHub → repo → **Settings → Secrets and variables → Actions**, add:

- `DATABASE_URL` — same Neon connection string.
- `SUPER_ADMIN_PASSWORD` — a strong password for the first admin (optional,
  only needed when creating the admin).

Then copy the two templates in `deploy/github-workflows/` into
`.github/workflows/` using the GitHub web UI (Add file → Upload files). The CLI
token used for this deployment does not have GitHub's `workflow` scope, so it
cannot create workflow files directly.

After that, run **Actions → Create super admin → Run workflow** with your email
and name. The analysis worker runs automatically every 30 minutes.

### 4. Vercel

I set `VITE_SOCKET_URL=https://mate-zone-chess-api.onrender.com` with the Vercel
CLI. `frontend/vercel.json` was already updated in this branch.

## What I do after you provide access

- Verify `/api/health` and the player-report routes.
- Set the Vercel env var and redeploy the frontend.
- Confirm REST calls and the Socket.IO handshake stop returning 404/CORS errors.

## Verification

```bash
curl https://mate-zone-chess-api.onrender.com/api/health
# → {"status":"ok"}

curl https://mate-zone-chess-api.onrender.com/api/player-report/1
# → 401/403 without a token, NOT 404
```

Render logs: Dashboard → `mate-zone-chess-api` → Logs.
GitHub Actions logs: repo → Actions → "Analysis worker".
