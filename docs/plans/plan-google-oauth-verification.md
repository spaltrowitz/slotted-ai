# Google OAuth Verification — Next Steps

## Status
- ✅ **Level 1 done:** App published from "Testing" → "Production" (Feb 27, 2025)
- ✅ **Privacy policy page built:** `client/src/pages/PrivacyPolicyPage.tsx` → `/privacy` route
- ⬜ **Level 2:** Submit for Google OAuth verification (removes "unverified app" warning)

## What Users See Now
After publishing, users who aren't test users will see a warning screen:
> "Google hasn't verified this app"

They can still proceed: **Advanced → "Go to slotted-ai.web.app (unsafe)"**. This is fine for beta but looks sketchy. Verification removes this.

## Steps to Submit for Verification

### 1. Deploy the privacy policy page
```bash
cd client && npm run build && cd .. && firebase deploy --only hosting
```
Verify it's live at: https://slotted-ai.web.app/privacy

### 2. Update the OAuth consent screen in Google Cloud Console
- Go to: https://console.cloud.google.com/apis/credentials/consent
- Set **Privacy Policy URL** to: `https://slotted-ai.web.app/privacy`
- Set **App Homepage** to: `https://slotted-ai.web.app`
- Make sure **App Name**, **Support Email**, and **Logo** are filled in

### 3. Verify your domain
- Go to: https://search.google.com/search-console
- Add and verify `slotted-ai.web.app` (Firebase hosting domains may already be verified via your Google Cloud project)

### 4. Record a demo video
- Record an **unlisted YouTube video** showing:
  1. User signs into Slotted with Google
  2. User connects their Google Calendar (the OAuth consent flow)
  3. App shows availability / suggests hangout times (how calendar data is used)
  4. User disconnects calendar from Settings
- Keep it 2–5 minutes. No need to be polished — Google reviewers just need to see the flow.

### 5. Prepare scope justifications
For each scope, write a 1–2 sentence justification:

| Scope | Justification |
|-------|--------------|
| `calendar.readonly` | Used to read the user's calendar list so they can select which calendars to share availability from. |
| `calendar.events.readonly` | Used to read calendar events and determine when the user is free or busy, so the app can suggest mutual availability with friends. Calendar event details are never stored or shared with other users. |
| `calendar.events` | Used to create calendar events when the user confirms a hangout plan with a friend, so the plan automatically appears on their Google Calendar. |

### 6. Submit for verification
- Go to: https://console.cloud.google.com/apis/credentials/consent
- Click **"Submit for Verification"**
- Attach: privacy policy URL, demo video link, scope justifications
- Provide test credentials if requested (a test account Google reviewers can use)

### 7. Wait for review
- **Brand verification** (name/logo): 2–3 business days
- **Sensitive scope verification** (calendar): can take 2–6 weeks
- Google may follow up with questions — check the email associated with the Cloud project
- Apps using restricted scopes require annual re-verification

## Notes
- The `support@slotted-ai.web.app` email in the privacy policy is a placeholder — update it with a real email before submitting
- If you want a custom domain later, you'll need to re-verify the new domain and update the privacy policy URL
- Changes to app name, logo, homepage, or scopes after verification require re-verification
