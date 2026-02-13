# Web Push Notifications Setup Guide

This guide explains how to configure Firebase Cloud Messaging (FCM) for Slotted's PWA push notifications.

## Overview

Slotted uses **Firebase Cloud Messaging (FCM)** to send push notifications to users via their web browser. This works across:
- ✅ **Desktop browsers** (Chrome, Firefox, Edge)
- ✅ **Android Chrome** (even when app is closed)
- ⚠️ **iOS Safari 16.4+** (only when PWA is installed and running)

---

## Setup Steps

### 1. Enable Firebase Cloud Messaging

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select `slotted-ai` project
3. Navigate to **Build → Cloud Messaging**
4. Cloud Messaging API should already be enabled

### 2. Generate VAPID Keys

VAPID keys are required for web push notifications to work.

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Click the **Cloud Messaging** tab
3. Scroll to **Web Push certificates**
4. Click **Generate key pair**
5. Copy the generated key (starts with `B...`)

### 3. Add VAPID Key to Environment Variables

Add the VAPID key to your local `.env.local` file:

```bash
# In /workspaces/social-scheduling/client/.env.local
VITE_FIREBASE_VAPID_KEY=BAbC1234567890...your-vapid-key-here...
```

**Note:** This file is not committed to git (and shouldn't be). In production, set this as an environment variable in your hosting platform.

### 4. Update Service Worker with Firebase Config

The service worker (`client/public/firebase-messaging-sw.js`) needs your Firebase project configuration.

Get your Firebase config from:
- Firebase Console → Project Settings → General → Your apps → Web app config

Update these values in `firebase-messaging-sw.js`:

```javascript
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "slotted-ai.firebaseapp.com",
  projectId: "slotted-ai",
  storageBucket: "slotted-ai.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
});
```

### 5. Add FCM Tokens Table to Supabase

Run this SQL in your Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  device_info TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, token)
);

CREATE INDEX idx_fcm_tokens_user ON fcm_tokens (user_id);
```

### 6. Test Locally

1. Build the frontend:
   ```bash
   cd client && npm run build
   ```

2. Serve build folder (service workers require HTTPS or localhost):
   ```bash
   npx serve build
   ```

3. Open `http://localhost:3000` in Chrome
4. Go to Settings → Enable push notifications
5. Grant permission when prompted
6. Check browser console for FCM token

### 7. Test Push Notification

1. Create a friend request or meetup invite
2. Check the recipient's browser — should see a native OS notification
3. Click the notification → should open/focus the app

---

## How It Works

### Frontend Flow

1. User clicks "Enable Notifications" button (Settings page)
2. Browser shows permission prompt
3. If granted → `usePushNotifications` hook gets FCM token
4. Token saved to database via `POST /users/me/fcm-token`

### Backend Flow

1. `createNotification()` function called (e.g., new friend request)
2. Notification saved to database
3. FCM tokens fetched for target user
4. Firebase Admin SDK sends push via `admin.messaging().sendEachForMulticast()`
5. Invalid tokens auto-removed from database

### Service Worker

- `firebase-messaging-sw.js` runs in background
- Receives FCM messages even when app is closed (on Android/desktop)
- Shows native OS notification
- Handles notification clicks → opens app

---

## Platform-Specific Behavior

### Desktop (Chrome/Edge/Firefox)
- ✅ Push works even when browser is closed
- ✅ Native OS notifications
- ✅ Badge counts (if supported)

### Android Chrome
- ✅ Push works when app is closed
- ✅ Fully reliable
- ✅ Badge counts on app icon

### iOS Safari 16.4+
- ⚠️ **Requires PWA to be installed** (Add to Home Screen)
- ⚠️ Only works when app is running in background
- ❌ No push when app is force-quit
- **Workaround:** Native iOS app would fix this (requires $99/year Apple Developer account)

---

## Debugging

### Check if FCM is working:

```bash
# Browser console (when requesting permission)
FCM Token: fs8dj2k...

# Firebase Functions logs
npx firebase functions:log
```

### Common Issues:

1. **"Firebase Messaging not supported"**
   - Check browser compatibility
   - Ensure HTTPS or localhost
   - iOS requires Safari 16.4+ and PWA installed

2. **"No FCM token available"**
   - VAPID key missing or incorrect
   - Check `.env.local` has `VITE_FIREBASE_VAPID_KEY`

3. **"Invalid registration token"**
   - Token expired — backend auto-removes invalid tokens
   - User may need to re-enable notifications

4. **Notifications not showing**
   - Check browser notification settings (OS level)
   - Check if user granted permission
   - iOS: Check if PWA is installed and running

---

## Production Deployment

1. Set `VITE_FIREBASE_VAPID_KEY` in Firebase Hosting environment variables
2. Ensure service worker is served with correct MIME type (`application/javascript`)
3. Service worker must be at root path (`/firebase-messaging-sw.js`)
4. Test on actual iOS device (not simulator)

---

## Security Notes

- FCM tokens are device-specific, not user-specific
- Tokens can be revoked at any time
- Backend validates auth before sending notifications
- Invalid tokens are automatically cleaned up
- VAPID keys are public and safe to expose in client code

---

## Cost

**Free Tier:**
- Unlimited FCM messages
- No Firebase cost for push notifications
- May incur Supabase storage costs for tokens table (negligible)

---

## Future Improvements (V2)

- [ ] Badge counts on PWA icon
- [ ] Rich notifications with images/actions
- [ ] Notification preferences (turn off specific types)
- [ ] Daily digest option instead of real-time
- [ ] Native iOS app for better iOS reliability

---

## References

- [Firebase Cloud Messaging Docs](https://firebase.google.com/docs/cloud-messaging/js/client)
- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
