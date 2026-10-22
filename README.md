# Bhandara Connect

A community event directory and member dashboard for sharing upcoming Bhandara events. The app uses React/Vite, Express, JWT authentication in HttpOnly cookies, and local JSON files. There is no public registration and no database service.

## Features

- Public upcoming event listing and event details with Google Maps links.
- Six fixed member accounts with equal event management rights.
- Login, profile display-name changes, password changes, and logout.
- Event creation, editing, archiving, restoring, and deletion.
- Server-side six-active-event limit with serialized JSON mutations.
- Activity history and safe public API responses.
- Responsive homepage, member login, and dashboard.

## Prerequisites and setup

Install Node.js 20 or newer. From the repository root:

```bash
npm install
npm run install:all
```

Copy `.env.example` to `server/.env`. Set a unique password of at least 12 characters for each of the six example usernames and set a long random `COOKIE_SECRET`. The sample values are examples only; replace every one. On PowerShell, for example:

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

The Vite client runs at <http://localhost:5173> and the API at <http://localhost:4000>. The client proxies `/api` to the backend. For a production frontend build, run `npm run build`; deploy the resulting `client/dist` with an appropriately configured Express/static host and set `CLIENT_ORIGIN` to the deployed origin. Set `COOKIE_SECURE=true` behind HTTPS.

## Commands

- `npm install` installs the root process runner.
- `npm run install:all` installs server and client packages.
- `npm run init:members` creates the six initial accounts.
- `npm run dev` starts API and frontend together.
- `npm test` runs isolated backend API tests.
- `npm run build` creates the production frontend bundle.

## Data and operations

Runtime files are stored in `server/data/members.json`, `events.json`, and `activity.json`. JSON writes use temporary files followed by atomic replacement. Event mutations are serialized inside the server process, which protects the six-event limit for a single running instance. Startup rejects unreadable or malformed JSON instead of replacing it. Back up all three JSON files regularly and retain protected copies before manual recovery.

JSON persistence assumes one server instance and a persistent writable filesystem. It is not transactional database storage and should not be shared across multiple instances. Platforms with ephemeral filesystems can lose data on restart or redeployment; attach persistent storage or use a different architecture before deploying there. Member sessions are signed JWT cookies and expire after eight hours; logout clears the browser cookie. Changing a password invalidates the current browser cookie.

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
