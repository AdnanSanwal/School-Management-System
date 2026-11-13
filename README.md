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
| Communication | Daily diary/homework with attachments (parents tick homework done), notices by audience, holidays calendar, push notifications, WhatsApp/SMS alerts |
| Facilities | Transport routes, stops and riders (fee added to the invoice), library catalogue, issue/return and late fines |
| Office | Owner dashboard, approvals inbox, leave management, PDF/Excel reports, year-end promotion, daily automation |
| Platform | Platform admin screen to onboard, list and suspend schools |

**Stack:** Node 20 + Express + Prisma (MySQL) · Next.js 14 web panel · Expo (React Native) mobile app · Redis (optional in development).

---

## Contents

- [Run it locally](#run-it-locally)
- [Demo logins](#demo-logins)
- [Mobile app](#mobile-app)
- [Run with Docker](#run-with-docker)
- [Configuration](#configuration)
- [HR, finance, roles and subscriptions](#hr-finance-roles-and-subscriptions)
- [Roles and logins](#roles-and-logins)
- [Adding a real school](#adding-a-real-school)
- [Deploy to a server](#deploy-to-a-server)
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

> **Dev mode is slower than the real app.** `npm run dev` compiles each web page the first time you open it
> (2–7 s), and again after every code change. That is not how fast the app is. To see real speed, run it
> in production mode instead (pages open in about 0.1 s and links are prefetched):
>
> ```bash
> npm run start:prod
> ```
>
> `npm run dev:turbo` uses Next.js's faster Turbopack compiler for development.

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
| `superadmin@platform.com` | Platform admin | Schools (onboard / suspend schools) |

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

The backend applies database migrations every time it starts. To load the demo data (first time only):

```bash
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

This compose file is for trying things out. For a real server use `docker-compose.prod.yml` (HTTPS, backups) — see [Deploy to a server](#deploy-to-a-server).

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (or `SENDGRID_API_KEY`), `EMAIL_FROM` | | Password-reset and broadcast emails, through any SMTP server or SendGrid |
| `MESSAGING_PROVIDER` | | WhatsApp/SMS alerts to parents: `twilio`, `test` (logs only, for development) or empty (off). Each school then turns alerts on in **School settings** |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_FROM` | | Twilio account; `TWILIO_WHATSAPP_FROM` like `whatsapp:+14155238886` for WhatsApp |
| `DEFAULT_COUNTRY_CODE` | | Turns local numbers like `0300…` into international ones. Default `92` (Pakistan) |
| `WEB_CONCURRENCY` | | Backend worker processes on one port (`auto` = one per CPU core). Needs `REDIS_URL`. Default 1 |
| `LOG_LEVEL`, `LOG_DIR` | | Log detail (`info`, `warn`, `debug`…) and an optional folder for log files. Production logs JSON to stdout |
| `SHUTDOWN_TIMEOUT_MS` | | How long a stopping server waits for in-flight requests. Default 15000 |
| `JWT_EXPIRES_IN` | | Sign-in token lifetime; apps renew it silently. Default `1h` |
| `METRICS_TOKEN` | | Locks `/metrics` behind `Authorization: Bearer <token>` |
| `NEXT_PUBLIC_SENTRY_DSN` | | Your own Sentry project for web error reports (empty = off) |
| `TRUST_PROXY` | behind a proxy | Number of reverse proxies in front of the API (`1` with Caddy/nginx) so rate limits see real client IPs |
| `RATE_LIMIT_MAX` | | Requests per IP per 15 minutes. Default `1000` |
| `GOOGLE_CLIENT_*`, `MS_CLIENT_*` | | "Sign in with Google/Microsoft" for accounts the school already created |
| `SENTRY_DSN` | | Error tracking |

Web panel (`frontend/.env.local`, optional): `NEXT_PUBLIC_API_URL`, default `http://localhost:5000/api/v1`.
Mobile (`mobile/.env`): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_PROJECT_ID`.

**School-level settings** (late fee amount and grace days, low-attendance threshold, library fine, payment accounts,
WhatsApp/SMS alerts, academic years, timezone) are set in the web panel under **School settings**, not in `.env`.

---

## HR, finance, roles and subscriptions

Every school gets all of these; what a person sees depends on their role, not on a paid add-on.

**HR and payroll** (sidebar → HR)

- Staff profiles with documents, departments and designations, salary structures with history,
  yearly leave allowances and balances.
- **Payroll** each month: the accountant prepares it, reviews every line, and sends it to the owner;
  the owner approves; the accountant pays it from a cash or bank account. Pay is worked out from the
  salary structure, staff attendance (absent, half day), unpaid leave and loan instalments.
- Advances and loans, printable payslips, the bank transfer sheet, and "My payslips" for staff.

**Finance and accounting** (sidebar → Finance)

- Money accounts (cash, bank, wallets). Fee payments land in the account for their payment method.
- Expenses (above a limit they wait for the owner's approval) and other income, with categories.
- A double-entry ledger worked out from those records, so it cannot disagree with them:
  **Statements** (income & expenditure, balance sheet, trial balance), the **Journal**, the
  **Chart of accounts** and each account's ledger. Fees count as income when they are received.
- **Month closing** locks everything dated up to a month; only the owner can reopen it.

**Roles and permissions** (owner → Settings → Roles & permissions)

- The owner chooses what each role may do in their school and which logins each role may create.
  Changes apply at once, to that school only. See [Roles and logins](#roles-and-logins).

**Subscriptions** (platform admin → Schools → Subscription)

- Each school has a plan, a paid-until date, notice and grace days and an optional student limit.
  Recording a payment moves the paid-until date.
- The school sees a notice before the end date and during the grace days. After that it is
  **locked**: people can sign in and see why, but nothing else works until it is renewed. Nothing is
  deleted. A school with no paid-until date never expires.

## Roles and logins

### The roles

There are eight fixed roles. A person has exactly one, set on their login. A school cannot invent
new roles; it tunes what the existing ones may do.

| Role | Who they are | What they see |
|---|---|---|
| Platform admin | The provider | All schools and their subscriptions; nothing inside a school |
| Owner | The school's owner | Everything in their school; approves payroll and large expenses |
| Principal | Academic and administrative head | Whole school; approves leave, results, concessions |
| Office admin | Front office | Admissions, staff records, fees, settings |
| Accountant | Finance | Fees, expenses, payroll, the books |
| Teacher | Class or subject teacher | Only their own classes |
| Parent | Guardian | Only their own children |
| Student | Pupil | Only their own record |

### Who can create which logins

The owner decides this per role under **Settings → Roles & permissions → May create logins for**.

| Creator | Standard | What the owner can allow |
|---|---|---|
| Platform admin | A school with its first owner | (fixed) |
| Owner | Every school role, including another owner | (fixed) |
| Principal | Office admin, Accountant, Teacher, Parent, Student | Any of these, or fewer |
| Office admin | Accountant, Teacher, Parent, Student | Any of these, or fewer |
| Accountant | Nobody | Teacher, Parent, Student |
| Teacher | Nobody | Parent, Student |
| Parent, Student | Nobody | (fixed) |

- A role can only be allowed to create roles below it. Only an owner can create an owner.
- Whoever may create a role may also disable those logins and reset their passwords. Nobody can
  change their own account this way.
- A role allowed to create nothing does not see **Users & logins**.
- Platform admins are not created from the app; see
  [docs/DEPLOY.md](docs/DEPLOY.md#4-first-login-the-platform-admin).

### How a login is created

Every login is tied to the right record, so it sees the right data.

| For | Where | Linked to |
|---|---|---|
| Owner | Platform admin → Schools → New school; or an owner under Users & logins | The school |
| Principal, Office admin, Accountant | Users & logins → Add login → Office user; or the Staff page | A staff record (created automatically) |
| Teacher | Staff page (when adding staff, or "Give login"); or Users & logins → Add login → Teacher | Their staff record |
| Parent | Student profile → Create parent login; or Users & logins → Add login → Parent | The guardian, so it covers all their children |
| Student | Student profile → Create student login; or Users & logins → Add login → Student | That student |

The creator sets a username (or email) and a starting password. The person must choose their own
password the first time they sign in. Changing someone's role signs them out everywhere.

### What a role may do

Each role has a standard set of permissions. The owner can change it per school under
**Settings → Roles & permissions**; all seven school roles are listed there.

- **Principal, Office admin, Accountant, Teacher**: the owner ticks or unticks what each may do.
- **Parent, Student**: their own view (profile, attendance, diary, results) is always on. Fees,
  homework ticks, transport and library can be switched. Fees are off for students as standard and
  can be switched on.
- **Owner**: always full access; this cannot be limited, and only the owner opens this screen.
- **Guard rails**: approvals (payroll, large expenses, results, concessions, timetable, reopening a
  closed month) can be given only to the principal. Teachers stay inside their own classes and can
  gain only a few school-wide jobs (notices, the calendar, the library).
- Everyone can read notices, the calendar and the timetable.

### What parents and students get

- **Web**: "My children" (parent) or "My school record" (student) with overview, attendance
  calendar, diary and homework, exams and results, timetable, library and transport, plus fees
  where allowed. A parent with several children switches between them.
- **Mobile app**: the same, plus paying fees online for parents.

## Adding a real school

Schools are created by the platform admin.

1. Create a platform admin. The demo seed creates `superadmin@platform.com`. For a clean install see
   [docs/DEPLOY.md](docs/DEPLOY.md#4-first-login-the-platform-admin).
2. Log in to the web panel as the platform admin → **Schools → New school**: name, code, first academic
   year and the owner's login. (Or through the API:)

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

## Deploy to a server

`docker-compose.prod.yml` runs everything on one Linux VPS: Caddy (automatic HTTPS), MySQL, Redis, the API,
the web panel and a nightly backup of the database and uploaded files.

```bash
cp .env.production.example .env.production      # set DOMAIN, passwords, secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Step-by-step guide, backups, restore and updates: **[docs/DEPLOY.md](docs/DEPLOY.md)**.
Security and reliability measures (and how they're tested): **[docs/SECURITY.md](docs/SECURITY.md)**.

### End of the school year

**Year-end promotion** (principal/admin) moves every student into the next class for the new academic year.
It can use an exam's results to keep failed students in their class, graduates the top class, copies subject
teachers and the fee structure, and makes the new year current. Add the new academic year in **School
settings** first.

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

### Login page branding

Set `PORTAL_NAME="Your School or Brand"` and `PORTAL_LOGO_PATH=/brand/logo.png` in `frontend/.env.local` for local development, or in the deployment `.env` for production Docker Compose. Place the logo at `frontend/public/brand/logo.png`. Use a transparent PNG, WebP or SVG and a same-origin path (external logo URLs are intentionally excluded by the security policy). The default is School ERP with the education emblem from the supplied login reference; missing or invalid images fall back to that emblem.

Restart the web server after changing settings (`docker compose --env-file .env -f docker-compose.prod.yml up -d frontend` in Docker). Text and path changes do not require rebuilding; adding a new image to the Docker image requires rebuilding frontend. Login branding is shared across the deployment; each school's existing name and logo settings still apply after sign-in. All roles use the same login form, with access determined by the authenticated account.

The same branding settings apply throughout the web app: browser tab title and icon, sidebar product name and logo, loading indicators, installable app name/icon, and web notification fallback branding. `PORTAL_ICON_PATH=/brand/icon.png` optionally supplies a separate compact icon (otherwise the logo is used). `PORTAL_DESCRIPTION` controls the page/manifest description. Use a square high-resolution PNG for the broadest browser and installed-app icon support. Existing installed apps may need to be reinstalled to refresh OS-cached names/icons; browser favicon caches may need a hard refresh. These settings configure the web deployment, not the native Expo app's compiled name/icons.

### Brands, branches and licensing

The hierarchy is **Platform → Brand → Branch**. A brand is the customer and subscription boundary; each branch keeps its own operational data. In the database and older API routes, `School` / `schoolId` represent a branch.

- **Superadmin:** opens **Brands & branches**, creates a brand with its first branch and owner login, adds branches, sets licence conditions, records renewals, and suspends brands or individual branches.
- **Owner:** signs in once, chooses **Current branch** in the header, and uses **All branches** for a read-only consolidated overview, shared brand settings and staff access assignments. Owners automatically access the branches of brands they own. They cannot create branches or change licensing.
- **Staff:** have a home branch and may receive explicit access to additional branches of the same brand, with a role and optional custom role per branch. Access changes end their existing sessions. An optional active, unlinked HR record in the target branch enables that branch's staff-specific views; payroll and attendance remain branch-local.
- **Parents and students:** remain scoped to their linked records in their own branch; they cannot receive staff branch access.
- **Licence:** one per brand, with a maximum branch count and maximum **active students per branch**. Student places are never pooled. Suspended branches still count toward the branch limit. Expiry, grace and renewal apply to all branches of the brand. Modules remain role-based.

The branch selector issues new branch-bound tokens, preserves the branch on token refresh, cancels and clears cached queries, and resets the web page's local state. Mobile users switch from the **More** menu. The server checks membership on each request; client-provided branch IDs alone never grant access. Consolidated endpoints explicitly verify brand ownership. Admissions and reactivations lock the branch row while checking capacity; branch creation locks the brand row while checking its branch count.

Run setup commands from `backend/`: `npx prisma migrate deploy`, `npx prisma generate`, then `npm run db:seed`. Stop running backend processes before client generation on Windows if the Prisma engine DLL is locked. The migration is additive and maps previous schools to brands; no database reset is required. The seed script adds **Greenfield North Campus** under the Greenfield owner and keeps Riverside as a separate brand, including when the main demo seed already exists. Licence limits are configured by superadmin; existing limits are preserved.

New APIs: `/api/v1/brands` (brand management, branches, access, summary, licensing) and `POST /api/v1/auth/switch-branch`. Legacy branch licence writes are refused for brand-linked branches. Separate deployment login branding (`PORTAL_*`) continues to apply before sign-in; the signed-in interface shows the brand and selected branch.
