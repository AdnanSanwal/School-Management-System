# Notifications

How a notification gets from "something happened" to a person, and what to check when it does not.

## The path

1. **Saved.** Code calls `notify()` (`backend/src/utils/notify.ts`). One row per person is saved in
   the `notifications` table, marked `PENDING`. This is the in-app record (the bell) and the
   delivery queue in one: a notification cannot exist without its delivery being owed.
2. **Live.** People with the web panel or the mobile app open are told at once over Socket.IO
   (`utils/live.ts`, `config/socket.ts`). Their bell count and list refresh by themselves.
3. **Pushed.** A delivery worker in every backend process (`utils/notificationDelivery.ts`)
   claims pending rows and sends them to phones (Expo, which hands over to Google and Apple) and
   browsers (Web Push).
4. **Texted, if urgent and unreached.** For absence, fee-due and low-attendance alerts, a person
   the app could not reach gets a text instead, when the school has switched this on in
   School settings (WhatsApp / SMS alerts).

## Delivery states (`notifications.deliveryState`)

| State | Meaning |
|---|---|
| `PENDING` | Waiting for the worker, or waiting to be tried again (`deliverAfter`). |
| `DELIVERED` | A push service accepted it for at least one device, or the person read it in the app first. |
| `UNREACHED` | The person has no phone or browser registered (or push is switched off on this server). |
| `FAILED` | Tried 5 times over about 45 minutes and gave up. `deliveryError` says why. |
| `EXPIRED` | Older than 24 hours before it could be pushed (for example after a long outage). It is still in the app. |
| `NONE` | Created before this system existed; nothing to deliver. |

## What keeps it reliable

- **Nothing is lost on a crash or restart.** The queue is in MySQL. A worker that dies holds its
  batch for two minutes at most; then another worker takes it over.
- **No double claims.** Workers pick rows with `FOR UPDATE SKIP LOCKED`, so any number of
  processes and servers can run side by side.
- **At-least-once.** A crash between sending and recording the result re-sends that batch. A rare
  duplicate alert is accepted in exchange for never dropping one.
- **Every outside call has a 15-second limit**, and failures are retried after 30 s, 2 min,
  10 min and 30 min.
- **Live events are a convenience, not the record.** If the live connection is down, the bell
  refreshes every minute, and the app catches up fully when it reconnects.

## Running several processes or servers

Live events travel between processes over Redis publish/subscribe (channel `live:events`).
Production already requires Redis, so `WEB_CONCURRENCY` above 1, or several servers behind the
proxy, need no extra setup. The proxy must pass WebSocket connections on `/socket.io/` to the
backend (the provided Caddyfile does).

## Settings

| Variable | Where | Purpose |
|---|---|---|
| `PUSH_DISABLED=true` | backend | No push is sent; rows settle as `UNREACHED`. |
| `JOBS_ENABLED=false` | backend | This process runs no delivery worker (and no daily jobs). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | backend | Browser push. Without them only phones are pushed to. |
| `MESSAGING_PROVIDER` | backend | Needed for the text fallback. |
| `NEXT_PUBLIC_SOCKET_URL` | web | Only if the live connection must use a different address than the API. |
| `NOTIFICATION_RETENTION_DAYS` | backend | Days to keep notifications (default 180, `0` = forever). |

## Checking on it

```sql
-- Is anything stuck?
SELECT deliveryState, COUNT(*) FROM notifications
WHERE createdAt > NOW() - INTERVAL 1 DAY GROUP BY deliveryState;
```

Prometheus (`/metrics`): `notification_deliveries_total{outcome}` and `live_connections`.

## Mutes, quiet hours and office messages

Three kinds of notification (`backend/src/utils/notificationRules.ts`):

| Kind | Types | Can a person mute it? | Held by quiet hours? | Text fallback? |
|---|---|---|---|---|
| Urgent | absence, fee due, low attendance | no | no | yes, if the school switched it on |
| Direct | a message the office sends by hand | no | no | no |
| Routine | everything else | yes | yes | no |

- **Mutes.** Each person chooses under Notifications, "What should alert me" (web and mobile).
  A muted type is still saved and listed in the app; it is not pushed and does not pop up.
- **Quiet hours.** The school sets them in School settings, on its own clock. A routine alert
  raised inside them is in the app at once and pushed when they end.
- **Office messages.** "Send a message" in the web panel: to everyone, to roles, to the
  families of chosen classes, sections or students, now or at a set time. A scheduled message
  can be cancelled until it goes out. The worker sends due messages within about 20 seconds
  of their time, and finishes a send that a restart cut off without repeating anyone.
- **Delivery report.** Each sent message shows how many it went to, how many pushes were
  delivered, failed or had nowhere to go, how many people have read it, and who was neither
  reached nor has read it.

## Clean-up

Once a day, notifications older than `NOTIFICATION_RETENTION_DAYS` (default 180) are deleted,
except any still waiting for delivery. Set it to `0` to keep everything. The messages
themselves (the `broadcasts` table) are kept; after their notifications are cleaned up, an
old message's report shows only its recipient total.

## Not included

- Expo push *receipts* (the later confirmation from Google/Apple). A phone that has uninstalled
  the app is removed when Expo reports it at send time.
- A per-person record of who opened a push alert (only "read in the app" is tracked).
