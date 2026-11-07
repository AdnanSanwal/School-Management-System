# Deploying to a VPS

This guide runs the whole ERP on one Linux server with Docker Compose. It uses:

- **Caddy** for HTTPS. It gets and renews the Let's Encrypt certificate on its own.
- **MySQL 8.4** and **Redis**.
- The **backend** API and the **web app**.
- A **backup** service that dumps the database and archives uploaded files every night.

Only Caddy is reachable from the internet (ports 80 and 443).

```
browser / mobile app ──HTTPS──► Caddy ─┬─ /api, /socket.io, /health ─► backend:5000 ─► MySQL, Redis, uploads volume
                                       └─ everything else ─────────────► frontend:3000
```

## 1. Server

- Ubuntu 22.04/24.04 with at least 2 vCPU, 4 GB RAM and 40 GB disk. One server like this handles several schools.
- A domain, e.g. `erp.yourschool.pk`, with an **A record** pointing at the server's IP.
- Open ports 22, 80 and 443 in the firewall:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

- Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in
```

## 2. Configure

```bash
git clone <your repo url> school-erp && cd school-erp
git checkout erp-v2
cp .env.production.example .env.production
nano .env.production
```

Fill in `DOMAIN`, both MySQL passwords and the four secrets. Generate each secret with:

```bash
openssl rand -hex 32
```

`AES_SECRET_KEY` encrypts sensitive fields such as MFA secrets. Keep a copy somewhere safe. If you lose it, that data can't be read.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

The first build takes a few minutes. Database migrations run automatically every time the backend starts. When `ps` shows the services as healthy, open `https://<DOMAIN>`.

To save typing, make an alias:

```bash
alias erp='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

## 4. First login: the platform admin

Create the platform admin account. This account onboards schools.

```bash
erp exec backend node -e "
const { basePrisma } = require('./dist/config/database');
const bcrypt = require('bcryptjs');
(async () => {
  const password = await bcrypt.hash(process.argv[1], 12);
  await basePrisma.user.create({ data: { role: 'SUPER_ADMIN', name: 'Platform admin', email: process.argv[2], password } });
  console.log('created'); process.exit(0);
})();" 'a-strong-password' 'admin@yourdomain.pk'
```

Log in with that email at `https://<DOMAIN>`. You land on **Schools**. Click **New school** and enter:

- the school's name and code
- its first academic year
- the owner's login

The owner then logs in and adds the principal, admin and accountant (**Users**), classes, staff, students and the fee structure.

To try the stack with demo data instead (**never on a live server with real schools**), run `erp exec backend node dist/database/seed.js`. It creates two demo schools; their logins are listed in the README.

## 5. Backups

The `backup` service runs every night at `BACKUP_HOUR`, in the server's `TZ`. Each run writes one folder:

```
backups/2026-11-08_0200/db.sql.gz        # full database (all schools)
backups/2026-11-08_0200/uploads.tar.gz   # student photos, documents, diary attachments, payment proofs
```

Folders older than `BACKUP_KEEP_DAYS` are deleted.

Take a backup right now, for example before an upgrade:

```bash
erp run --rm backup once
```

**Copy backups off the server.** A backup that lives only on the same disk is lost with that disk. Any of these work:

```bash
# from your own computer, pull the backups every day
rsync -az user@server:school-erp/backups/ ./erp-backups/

# or, on the server, push them to object storage with rclone (Backblaze B2, S3, Google Drive…)
rclone sync ~/school-erp/backups remote:erp-backups   # add to crontab: 30 3 * * *
```

### Restore

```bash
./deploy/restore.sh backups/2026-11-08_0200
```

The script stops the app and replaces the database and uploads with that backup. It then starts the app again and asks you to type `restore` before it changes anything. Test a restore on a spare server once, so you know the process works before you need it.

## 6. Updating

```bash
erp run --rm backup once          # safety copy first
git pull
erp up -d --build                 # rebuilds and restarts; migrations apply on start
docker image prune -f
```

## 7. Optional features

| Feature | Settings in `.env.production` | Where schools switch it on |
|---|---|---|
| WhatsApp / SMS alerts | `MESSAGING_PROVIDER=twilio`, `TWILIO_*` (`TWILIO_WHATSAPP_FROM=whatsapp:+…` for WhatsApp) | School settings → WhatsApp / SMS alerts |
| Online fee payment | `PAYMENT_GATEWAY`, `PAYMENT_GATEWAY_SECRET` | automatic (parents see **Pay online**) |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) | automatic |
| Error tracking | `SENTRY_DSN` | — |

The daily jobs (`JOBS_ENABLED=true`) run at `JOBS_RUN_HOUR`:

- Every day, they add late fees.
- On Mondays, they also send fee reminders and low-attendance alerts.

After changing `.env.production`, run `erp up -d` to apply it.

## 8. Mobile app

Build the Expo app with the API pointing at your domain:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://<DOMAIN>/api/v1 npx eas build -p android
```

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Browser shows a certificate error | DNS must point at this server, and ports 80/443 must be open. Then run `erp logs caddy`. |
| 502 from Caddy | `erp ps` (is the backend healthy?), then `erp logs backend` |
| Backend restarts in a loop | `erp logs backend`. Usually a missing setting or a failed migration. |
| Uploads disappear after an update | Uploads live in the `uploads_data` volume. Never run `docker compose down -v` on the server. |
| See all logs | `erp logs -f --tail 200` |

`docker compose down -v` **deletes the database and uploads volumes**. Never use `-v` in production.
