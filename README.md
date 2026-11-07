# School ERP

A multi-school school management system: one installation serves many schools, each with its own data,
staff, parents and fees. It comes with a web panel for the office and a mobile app for parents, teachers
and owners.

**Roles:** Owner · Principal · Office admin · Accountant · Teacher · Parent · Student (plus a platform admin who onboards schools).

| Area | What it does |
|---|---|
| Students & staff | Admissions with guardians and sibling linking, documents and photos, staff with app logins, classes/sections, subject teachers |
| Attendance | Teachers mark their sections (one tap "all present"), staff attendance, parents alerted on absence, monthly low-attendance alerts |
| Fees | Class-wise fee structure, monthly invoices, concessions (principal approves), counter collection with printable receipts, defaulters, late fees, reminders |
| Online payment | Parent pays to a school JazzCash/Easypaisa/bank account and submits proof → accountant verifies; pluggable payment-gateway checkout |
| Academics | Exams with date sheet → principal approves → marks entry → publish; grades, positions, PDF report cards; timetable with clash checks |
| Communication | Daily diary/homework with attachments, notices by audience, holidays calendar, push notifications |
| Office | Owner dashboard, approvals inbox, leave management, PDF/Excel reports, daily automation |

**Stack:** Node 20 + Express + Prisma (MySQL) · Next.js 14 web panel · Expo (React Native) mobile app · Redis (optional in development).

---

## Contents

- [Run it locally](#run-it-locally)
- [Demo logins](#demo-logins)
- [Mobile app](#mobile-app)
- [Run with Docker](#run-with-docker)
- [Configuration](#configuration)
- [Adding a real school](#adding-a-real-school)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## Run it locally

### 1. Prerequisites

| | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| npm | 10 or newer | comes with Node |
| MySQL | 8.x | an empty database the app can create tables in |
| Redis | 7.x | **optional** in development — without it the API uses an in-memory store and logs a harmless `Redis error ECONNREFUSED` |

### 2. Install

```bash
git clone https://github.com/AdnanSanwal/School-Management-System.git
cd School-Management-System
npm install
```

`npm install` at the root installs the backend and the web panel (they are npm workspaces).
The mobile app is installed separately — see [Mobile app](#mobile-app).

### 3. Configure

Copy the template into the backend folder and edit it:

```bash
cp .env.example backend/.env
```

The values you **must** set in `backend/.env`:

```ini
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/school_db"
JWT_SECRET=...            # long random string
REFRESH_TOKEN_SECRET=...  # a different long random string
AES_SECRET_KEY=...        # 64 hex characters
```

Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Everything else can stay as it is for local development. All settings are listed under [Configuration](#configuration).

### 4. Create the database tables and demo data

Run Prisma commands **from the `backend` folder**. It is where `prisma/schema.prisma` lives.

```bash
cd backend
npx prisma migrate deploy
npm run db:seed
cd ..
```

`migrate deploy` creates the database if it doesn't exist and applies every migration. `db:seed` adds two
demo schools (see [Demo logins](#demo-logins)). It does nothing if the demo data is already there.

To wipe the database and start again (this **deletes all data**):

```bash
cd backend
npx prisma migrate reset
```

### 5. Start

```bash
npm run dev
```

This starts both apps:

| | URL |
|---|---|
| Web panel | http://localhost:3000 |
| API | http://localhost:5000/api/v1 (health check: http://localhost:5000/health) |

---

## Demo logins

Every demo account uses the password **`Admin@123`**.

| Email | Role | Lands on |
|---|---|---|
| `owner@school.com` | Owner | Dashboard |
| `principal@school.com` | Principal | Dashboard, approvals, exams |
| `admin@school.com` | Office admin | Admissions, fees, settings |
| `accountant@school.com` | Accountant | Collect fee, collections, defaulters |
| `teacher@school.com` | Teacher (class teacher of 8-A) | Attendance, diary, marks |
| `parent@school.com` | Parent of two children (8-A and 6-B) | Mobile app / "My children" |
| `student@school.com` | Student (8-A) | Mobile app |
| `owner@riverside.com` | Owner of a second school | Used to check that schools can't see each other's data |
| `superadmin@platform.com` | Platform admin | Onboards new schools (API only) |

The demo school "Greenfield Public School" has 48 students in Classes 6–8, a month of attendance,
fee invoices from August, notices, diary entries and a timetable for 8-A.

---

## Mobile app

One Expo app for every role. What you see depends on the login: parents and students get the
family app, teachers get the teacher app, and owners/principals/office get the dashboard and approvals.

```bash
cd mobile
npm install --legacy-peer-deps
```

**In a browser** (quickest way to try it):

```bash
npm run web
```

Then open http://localhost:8081. The API already allows this address in development.

**On a phone** with [Expo Go](https://expo.dev/go):

1. Your phone and computer must be on the same Wi-Fi.
2. Create `mobile/.env` with your computer's local IP address (find it with `ipconfig` on Windows or `ifconfig` on Mac/Linux):
   ```ini
   EXPO_PUBLIC_API_URL=http://192.168.1.20:5000/api/v1
   ```
3. Run `npm start` in `mobile/` and scan the QR code with Expo Go.

For the Android emulator, use `http://10.0.2.2:5000/api/v1`.

**Push notifications on phones** need an Expo account and a development build: Expo Go on Android no
longer receives remote push. Create an EAS project, put its id in `mobile/.env` as
`EXPO_PUBLIC_PROJECT_ID=...`, and build with `eas build --profile development`. Everything else works without push:
notifications are always saved and shown in the app.

---

## Run with Docker

Requires Docker Desktop (or Docker Engine with Compose v2). This runs MySQL, Redis, the API and the web panel:

```bash
cp .env.example backend/.env       # then set JWT_SECRET, REFRESH_TOKEN_SECRET, AES_SECRET_KEY
docker compose up -d --build mysql redis backend frontend
```

The first time only, create the tables and (optionally) load the demo data:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend node dist/database/seed.js
```

| | URL |
|---|---|
| Web panel | http://localhost:3000 |
| API | http://localhost:5000 |
| MySQL | `localhost:3307`, user `sms_user` / password `sms_pass` |

Compose sets `DATABASE_URL`, `REDIS_URL` and `UPLOAD_DIR` for the containers itself, overriding
`backend/.env`. Uploaded files are kept in the `uploads_data` volume. Change the database passwords with
`MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` environment variables before the first start.

`docker compose up -d` with no service names also starts the optional monitoring stack (nginx,
Prometheus, Grafana, ELK).

```bash
docker compose logs -f backend      # follow API logs
docker compose down                 # stop
docker compose down -v              # stop and DELETE the database and uploads
```

> The Kubernetes manifests in `k8s/` were written for the earlier PostgreSQL version and have not been updated yet.

---

## Configuration

Backend settings live in `backend/.env` (template: `.env.example`).

| Setting | Required | What it does |
|---|---|---|
| `DATABASE_URL` | ✔ | MySQL connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | ✔ | Sign login tokens. Use different long random values |
| `AES_SECRET_KEY` | ✔ | 64 hex chars, encrypts sensitive fields |
| `PORT` | | API port, default `5000` |
| `FRONTEND_URL` | | Web panel address(es), comma-separated. Used for CORS and password-reset links |
| `BACKEND_URL` | in production | Public address of the API. Used in signed file/report-card links and payment-gateway callbacks |
| `REDIS_URL` | in production | Without Redis, logins don't survive an API restart and logout isn't shared between servers |
| `UPLOAD_DIR` | | Where uploaded documents and photos are stored. Default `backend/uploads` |
| `FILE_URL_SECRET` | | Signs file links. Defaults to `JWT_SECRET` |
| `PAYMENT_GATEWAY` | | Online checkout provider. `test` = built-in simulated gateway for development (refused in production). Empty = parents pay to school accounts and submit proof |
| `PAYMENT_GATEWAY_SECRET` | | Secret for gateway callbacks. Defaults to `JWT_SECRET` |
| `JOBS_ENABLED`, `JOBS_RUN_HOUR` | | Daily automation after this hour, school time: late fees every day; fee reminders and low-attendance alerts on Mondays. Default on, 9 |
| `PUSH_DISABLED` | | `true` skips sending push (notifications are still saved in the app) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | | Browser push. Generate with `npx web-push generate-vapid-keys` |
| `SENDGRID_API_KEY`, `EMAIL_FROM` | | Password-reset and broadcast emails |
| `TWILIO_*` | | SMS for broadcasts |
| `GOOGLE_CLIENT_*`, `MS_CLIENT_*` | | "Sign in with Google/Microsoft" for accounts the school already created |
| `SENTRY_DSN` | | Error tracking |

Web panel (`frontend/.env.local`, optional): `NEXT_PUBLIC_API_URL`, default `http://localhost:5000/api/v1`.
Mobile (`mobile/.env`): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_PROJECT_ID`.

**School-level settings** (late fee amount and grace days, low-attendance threshold, payment accounts,
academic years, timezone) are set in the web panel under **School settings**, not in `.env`.

---

## Adding a real school

Schools are created by the platform admin through the API. There is no screen for this yet.

1. Create a platform admin. The demo seed creates `superadmin@platform.com`. For a clean install, run the seed once and change that password, or insert a `SUPER_ADMIN` user yourself.
2. Log in and create the school with its first academic year and owner:

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"superadmin@platform.com","password":"Admin@123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")

curl -X POST http://localhost:5000/api/v1/platform/schools \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "City Grammar School", "code": "city-grammar",
    "academicYear": { "name": "2026-27", "startDate": "2026-04-01", "endDate": "2027-03-31" },
    "owner": { "name": "School Owner", "email": "owner@citygrammar.pk", "password": "ChangeMe@2026" }
  }'
```

3. The owner signs in to the web panel and sets things up in this order: **Users & logins** (principal, admin,
   accountant) → **School settings** (contact details, late fee, payment accounts) → **Classes**
   (classes, sections, subjects) → **Staff** (teachers, with app logins) → **Fee structure** →
   **Students → New admission** (guardian logins give parents the app) → **Invoices → Generate month**.

---

## Tests

```bash
npm test --workspace=backend
```

This runs the unit and API tests, with no database needed. To also run the end-to-end tests against your MySQL:

```bash
# bash
RUN_DB_TESTS=1 npm test --workspace=backend
# PowerShell
$env:RUN_DB_TESTS=1; npm test --workspace=backend
```

The database tests create their own throwaway schools and delete them afterwards. They don't touch the demo data.

Type checks: `npx tsc --noEmit -p backend`, `npx tsc --noEmit -p frontend`, and `npm run typecheck` in `mobile/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not find Prisma Schema` | Run Prisma commands inside `backend/`, not the repo root |
| `the URL must start with the protocol postgresql://` (or the client looks out of date) | The generated Prisma client is stale. Run `npx prisma generate` in `backend/` and restart |
| `Redis error ECONNREFUSED` in the API log | Harmless in development: the API switched to its in-memory store. Start Redis or set `REDIS_URL` to silence it |
| `npm error Missing script: "devnpx"` | Two commands typed on one line. Run `npm run dev` on its own |
| Port 3000 or 5000 already in use | Stop the other process, or change `PORT` / run Next on another port and add it to `FRONTEND_URL` |
| The web panel loads but every request fails | Check `NEXT_PUBLIC_API_URL`, and that the panel's address is listed in `FRONTEND_URL` |
| Phone app can't reach the server | Use your computer's LAN IP in `EXPO_PUBLIC_API_URL` (not `localhost`), same Wi-Fi, firewall allows port 5000 |
| `P2034` / deadlock warnings in the log | Expected under concurrent writes. The API retries these automatically |

---

## Project layout

```
backend/            Express API (TypeScript)
  prisma/           schema.prisma + migrations
  src/modules/      one folder per feature (students, fees, exams, payments, …)
  src/config/       database (tenant-scoped Prisma client), tenancy, redis, socket
  src/jobs/         daily automation
  src/database/     demo seed
frontend/           Next.js web panel
mobile/             Expo app (parents, students, teachers, owners)
docs/ERP_V2.md      developer guide: tenancy rules, permissions, module conventions, phase notes
docker-compose.yml  MySQL, Redis, API, web panel (+ optional monitoring stack)
```

Anyone writing code should read [`docs/ERP_V2.md`](docs/ERP_V2.md) first. It explains how school data is kept
separate (every query is scoped to the signed-in school automatically) and the rules new modules must follow.

## License

MIT
