# Push notifications on a real Android phone

What you need to do once so the mobile app can receive push alerts on a real phone, and how
to test it against the server on your PC. Allow about an hour, most of it waiting for the build.

The project side is prepared: `mobile/eas.json` (build profiles), `mobile/app.config.js`
(picks up the Firebase file and the project id) and the `expo-dev-client` package.

You need: an Android phone on the same Wi-Fi as the PC, a free Expo account, and a Google
account for Firebase. (An iPhone needs a paid Apple Developer account instead of step 2.)

## 1. Expo account and project id

In a terminal, from the `mobile` folder:

```bash
npm install --global eas-cli
```

```bash
eas login
```

```bash
eas init
```

`eas init` creates the project on your Expo account and writes its id into `mobile/app.json`
(`extra.eas.projectId`). Commit that change: every build needs it.

## 2. Firebase (Android push goes through Google)

1. Open <https://console.firebase.google.com>, create a project (Analytics is not needed).
2. Add an **Android app** with the package name `com.schoolerp.app`.
3. Download `google-services.json` and put it in the `mobile` folder.
4. In Firebase: Project settings, Service accounts, **Generate new private key**. This
   downloads a JSON key. Keep it out of the repository.
5. Give that key to Expo so it can send through your Firebase project:

```bash
eas credentials
```

   Choose Android, then "Google Service Account", then "Manage your Google Service Account Key
   for Push Notifications (FCM V1)", and upload the key file from step 4.

`google-services.json` identifies the app to Google; it is not a password, but restrict its
API key to the package name in the Google Cloud console if the repository is public.

## 3. Point the app at your PC

Find the PC's Wi-Fi address (`ipconfig`, the IPv4 line, for example `192.168.1.20`). Create
`mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000/api/v1
```

Allow Node through the Windows firewall for private networks when Windows asks (ports 5000
and 8081).

## 4. Build and install the app

```bash
eas build --profile development --platform android
```

When it finishes (15 to 30 minutes), open the link it prints on the phone and install the
APK. This is a development build: it loads the app's code from your PC, and it can receive
push, which the plain Expo Go app cannot on Android.

## 5. Run and test

1. Start the backend on the PC (`npm run dev:backend` from the repository root). Check that
   `PUSH_DISABLED` is not `true` in `backend/.env`.
2. From `mobile`:

```bash
npx expo start --dev-client
```

3. Open the installed app on the phone, scan the QR code, sign in as `parent@school.com`,
   and allow notifications when asked.
4. Confirm the phone registered. In `backend`:

```bash
npx prisma studio
```

   The `device_tokens` table should have a row for that login.
5. Put the app in the background. In the web panel, sign in as the principal, open
   **Send a message**, and send one to Parents.
6. Expected: the phone shows the alert within a few seconds; tapping it opens the app; the
   message's delivery report shows "Push delivered: 1".

## If it does not arrive

| What you see | Likely cause |
|---|---|
| No row in `device_tokens` | Notifications not allowed on the phone, no project id (step 1), or the app cannot reach the PC (step 3, firewall). |
| Report says "No phone or browser" | Same as above: the server has no token for that person. |
| Report says "Push failed" | Expo refused it. The usual reason is a missing or wrong FCM key (step 2.5). |
| Report says "Push delivered" but nothing on the phone | Battery saver or the phone's own notification settings for the app. |
| App shows "Cannot reach the school server" | Wrong address in `mobile/.env`, different Wi-Fi, or the firewall. |

For the Play Store build later, use `eas build --profile production --platform android`; the
same Firebase project and key keep working.
