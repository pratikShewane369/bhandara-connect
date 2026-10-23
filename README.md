# Bhandara Connect

A community event directory and member dashboard for sharing upcoming Bhandara events. The app uses React/Vite, Express, JWT authentication in HttpOnly cookies, and MongoDB for deployed data. There is no public registration.

## Features

- Public upcoming event listing and event details with Google Maps links.
- Six fixed member accounts with equal event management rights.
- Login, profile display-name changes, password changes, and logout.
- Event creation, editing, archiving, restoring, and deletion.
- Server-side six-active-event limit with serialized JSON mutations.
- Activity history and safe public API responses.
- Public visitor statistics: total visits, estimated current visitors, and unique monthly active browsers.
- Responsive homepage, member login, and dashboard.

## Prerequisites and setup

Install Node.js 20 or newer. From the repository root:

```bash
npm install
npm run install:all
```

Copy `.env.example` to `server/.env`. Set `MONGODB_URI` to your MongoDB connection string, a unique password of at least 12 characters for each of the six example usernames, and a long random `COOKIE_SECRET`. The sample values are examples only; replace every one. On PowerShell, for example:

```powershell
Copy-Item .env.example server/.env
```

Edit `server/.env` with a protected editor. Then initialize the accounts once:

```bash
npm run init:members
```

Initialization refuses to replace an existing member file and does not print credentials. Protect `server/.env` and back it up securely. Do not commit it.

If you later change a member username, password, or display name in `server/.env`, apply those changes to existing accounts with `npm run sync:members` from the repository root. This preserves member IDs and event ownership; changed passwords invalidate existing sessions. The command never prints credentials.

## Run the app

```bash
npm run dev
```

The Vite client runs at <http://localhost:5173> and the API at <http://localhost:4000>. The client proxies `/api` to the backend. If `MONGODB_URI` is configured, the server stores members, events, and activity in MongoDB; without it, local development and tests use JSON files. Production startup requires `MONGODB_URI`. Set `COOKIE_SECURE=true` behind HTTPS and set `CLIENT_ORIGIN` to the deployed frontend origin.

## Commands

- `npm install` installs the root process runner.
- `npm run install:all` installs server and client packages.
- `npm run init:members` creates the six initial accounts.
- `npm run migrate:mongodb --workspace server` imports local JSON records into MongoDB without replacing records already stored there.
- `npm run dev` starts API and frontend together.
- `npm test` runs isolated backend API tests.
- `npm run build` creates the production frontend bundle.

## Data and operations

With MongoDB configured, the `members`, `events`, and `activity` collections are stored in the configured database. Visitor metrics use separate `site_metrics`, `site_metric_monthly_visitors`, and `site_metric_online_visitors` collections. The browser stores a random anonymous ID locally; monthly active users count distinct browser IDs, and online visitors are those with a heartbeat in the last two minutes. Without MongoDB, local development and tests keep metrics in memory. The migration command imports local JSON records while preserving their IDs and password hashes. Without MongoDB, local development and tests use `server/data/members.json`, `events.json`, and `activity.json`; JSON writes use temporary files followed by atomic replacement. Event mutations are serialized inside the server process, which protects the six-event limit for a single running instance.

MongoDB Atlas provides persistence across Render restarts and redeployments. Keep the connection string in the hosting provider's environment variables and in the ignored `server/.env`; never commit it. The app hashes member passwords before storage. JSON file storage is intended only for local development or tests, not ephemeral production filesystems. Member sessions are signed JWT cookies and expire after eight hours; logout clears the browser cookie. Changing a password invalidates the current browser cookie.

Event dates are compared and displayed using `Asia/Kolkata` by default. Set `APP_TIMEZONE` to an IANA timezone if the group operates elsewhere. Event images currently use a generated visual fallback; image upload is intentionally not enabled, so large base64 payloads cannot enter the JSON data.

## Structure

```text
client/       React UI, routes, styles, and Vite setup
server/src/   Express API, authentication, validation, storage, and event service
server/data/  Private runtime JSON files (ignored by Git)
server/test/  Isolated API tests using temporary JSON files
```

## Troubleshooting

- **Login says authentication is not configured:** set `COOKIE_SECRET` in `server/.env` and restart the API.
- **No member records:** configure the six environment entries and run `npm run init:members` once.
- **Port is in use:** change `PORT` in `server/.env` or stop the other process.
- **Storage validation fails:** stop the server and inspect/restore the affected JSON file from a backup; the app will not silently reset corrupt data.
- **Browser requests fail:** ensure `CLIENT_ORIGIN` matches the browser origin and restart the API.
