# Plan: Outlook Calendar Integration

## Approach
Add Microsoft Outlook as a third calendar provider, matching Google Calendar's current scope: OAuth connection, calendar listing, availability sync, and auto-add meetups to calendar. Follow the existing if/else branching pattern (no abstraction refactor). Uses Microsoft Graph API with `@azure/msal-node` for OAuth and `@microsoft/microsoft-graph-client` for API calls.

## Prerequisites (Manual — User)
1. Go to [Azure Portal → App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click "New registration"
   - Name: "Slotted"
   - Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
   - Redirect URI: Web → `https://slottedapp.com/api/calendar/outlook/callback`
3. Note the **Application (client) ID** → set as `MICROSOFT_CLIENT_ID`
4. Go to "Certificates & secrets" → New client secret → copy value → set as `MICROSOFT_CLIENT_SECRET`
5. Set `MICROSOFT_TENANT_ID=common` (allows both personal and work/school accounts)
6. Set `MICROSOFT_REDIRECT_URI=https://slottedapp.com/api/calendar/outlook/callback`
7. Go to "API permissions" → Add:
   - `Calendars.Read`
   - `Calendars.ReadWrite`
   - `offline_access`
   - `User.Read`

## Phase 1: Database Migration

### Task 1.1: Create migration file
**File:** `migrations/add_outlook_calendar.sql`

```sql
-- Add Outlook credential columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- Update user_calendars source constraint to include 'outlook'
ALTER TABLE user_calendars DROP CONSTRAINT IF EXISTS user_calendars_source_check;
ALTER TABLE user_calendars ADD CONSTRAINT user_calendars_source_check 
  CHECK (source IN ('google', 'apple', 'outlook'));
```

### Task 1.2: Update canonical schema
**File:** `database/schema.sql`
- Add `outlook_*` columns to `users` table definition
- Update `user_calendars.source` CHECK constraint

## Phase 2: Backend — Dependencies & Helpers

### Task 2.1: Install dependencies
```bash
cd functions && npm install @azure/msal-node @microsoft/microsoft-graph-client
```

### Task 2.2: Add MSAL client helpers to functions/src/index.ts
Near the existing `getOAuth2Client()` / `getAuthedCalendarClient()` functions (~line 6329), add:

```typescript
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";

const MICROSOFT_SCOPES = [
  "Calendars.Read",
  "Calendars.ReadWrite",
  "offline_access",
  "User.Read",
];

function getMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}`,
    },
  });
}

async function getOutlookGraphClient(firebaseUid: string): Promise<GraphClient | null> {
  const user = await getDbUser(firebaseUid);
  if (!user?.outlook_refresh_token) return null;

  const msalClient = getMsalClient();
  
  try {
    const result = await msalClient.acquireTokenByRefreshToken({
      refreshToken: user.outlook_refresh_token,
      scopes: MICROSOFT_SCOPES.filter(s => s !== "offline_access"),
    });

    if (!result) return null;

    // Persist refreshed tokens
    const updates: Record<string, unknown> = {
      outlook_access_token: result.accessToken,
      outlook_token_expires_at: result.expiresOn?.toISOString() || null,
    };
    // MSAL may return a new refresh token (token rotation)
    if ((result as any).refreshToken) {
      updates.outlook_refresh_token = (result as any).refreshToken;
    }
    await getSupabase()
      .from("users")
      .update(updates)
      .eq("firebase_uid", firebaseUid);

    return GraphClient.init({
      authProvider: (done) => done(null, result.accessToken),
    });
  } catch (err) {
    console.error("Failed to get Outlook Graph client:", err);
    return null;
  }
}
```

## Phase 3: Backend — OAuth Routes

### Task 3.1: Auth URL endpoint
**Route:** `GET /calendar/outlook/auth-url`
```typescript
app.get("/calendar/outlook/auth-url", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const msalClient = getMsalClient();
    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: MICROSOFT_SCOPES,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI!,
      state: req.uid!,
      prompt: "consent",
    });
    res.json({ url: authUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

### Task 3.2: Callback endpoint
**Route:** `GET /calendar/outlook/callback`
Exchanges auth code for tokens, stores in DB, fetches calendar list, redirects to dashboard.

### Task 3.3: Disconnect endpoint
**Route:** `POST /calendar/outlook/disconnect`
Clears Outlook tokens from users table, removes `source='outlook'` rows from `user_calendars`.

### Task 3.4: Calendar list endpoint
**Route:** `GET /calendar/outlook/list`
Calls `GET /me/calendars` via Graph client, upserts into `user_calendars` with `source='outlook'`.

### Task 3.5: Status endpoint update
Update existing `/calendar/status` to include `outlook: true/false` based on `outlook_calendar_connected`.

## Phase 4: Backend — Sync & Event Creation

### Task 4.1: Extend syncUserCalendar()
Add Outlook branch after Google and Apple checks:
```typescript
// ─── Outlook Calendar ───
const hasOutlook = !!dbUser.outlook_calendar_connected && !!dbUser.outlook_refresh_token;
if (hasOutlook) {
  const graphClient = await getOutlookGraphClient(firebaseUid);
  if (graphClient) {
    // Fetch selected Outlook calendars
    const { data: outlookCals } = await sb
      .from("user_calendars")
      .select("calendar_id")
      .eq("user_id", dbUser.id)
      .eq("source", "outlook")
      .eq("is_selected", true);

    for (const cal of outlookCals || []) {
      const events = await graphClient
        .api(`/me/calendars/${cal.calendar_id}/calendarView`)
        .query({ startDateTime: rangeStart, endDateTime: rangeEnd })
        .select("subject,start,end,showAs,isCancelled")
        .get();

      for (const event of events.value || []) {
        if (event.isCancelled || event.showAs === "free") continue;
        allBusyBlocks.push({
          start: new Date(event.start.dateTime + "Z"),
          end: new Date(event.end.dateTime + "Z"),
        });
      }
    }
  }
}
```

### Task 4.2: Extend autoAddToCalendar()
Add Outlook branch after Google, before Apple:
```typescript
// ─── Try Outlook Calendar if Google didn't work ───
if (!addedEventId && dbUser.outlook_calendar_connected && dbUser.outlook_refresh_token) {
  try {
    const graphClient = await getOutlookGraphClient(firebaseUid);
    if (graphClient) {
      const outlookEvent = await graphClient.api("/me/events").post({
        subject: eventTitle,
        body: { contentType: "text", content: eventDescription },
        start: {
          dateTime: meetup.start_time,
          timeZone: dbUser.timezone || "America/New_York",
        },
        end: {
          dateTime: meetup.end_time,
          timeZone: dbUser.timezone || "America/New_York",
        },
        location: meetup.location ? { displayName: meetup.location } : undefined,
        reminderMinutesBeforeStart: 15,
        isReminderOn: true,
      });
      addedEventId = outlookEvent.id;
    }
  } catch (err) {
    console.error(`Outlook auto-add failed for ${dbUser.email}:`, err);
  }
}
```

## Phase 5: Frontend

### Task 5.1: Update AuthContext.tsx
- Add state: `outlookCalendarConnected`
- Add `connectOutlookCalendar()` — calls `GET /calendar/outlook/auth-url`, redirects
- Add `disconnectOutlookCalendar()` — calls `POST /calendar/outlook/disconnect`
- Update profile fetch to check Outlook status

### Task 5.2: Update SettingsPage.tsx
Add Outlook section between Google and Apple, following same UI pattern:
- Outlook icon (📧 or Microsoft logo SVG)
- Connect/Manage button
- Expandable details with CalendarPicker and disconnect

### Task 5.3: Update CalendarPicker.tsx
- Update `CalendarInfo.source` type to include `'outlook'`
- Add `listEndpoint` case for `'outlook'` → `/calendar/outlook/list`

### Task 5.4: Update CalendarPicker props type
- `CalendarPickerProps.source` type: `'google' | 'apple' | 'outlook'`

### Task 5.5: Handle callback redirect
Ensure dashboard handles `?calendar=connected` from Outlook callback (already works since it's the same param).

## Phase 6: Validation & Docs

### Task 6.1: Type-check frontend
```bash
cd client && npx tsc --noEmit
```

### Task 6.2: Build functions
```bash
cd functions && npm run build
```

### Task 6.3: Update docs/06-mvp-current-state.md
Add Outlook to calendar providers section.

---

## Todo List

### Phase 1: Database
- [x] 1.1 Create migration `migrations/add_outlook_calendar.sql`
- [x] 1.2 Update `database/schema.sql` canonical schema

### Phase 2: Backend Helpers
- [x] 2.1 Install `@azure/msal-node` and `@microsoft/microsoft-graph-client`
- [x] 2.2 Add MSAL client helpers (getMsalClient, getOutlookGraphClient)

### Phase 3: Backend OAuth Routes
- [x] 3.1 `GET /calendar/outlook/auth-url`
- [x] 3.2 `GET /calendar/outlook/callback`
- [x] 3.3 `POST /calendar/outlook/disconnect`
- [x] 3.4 `GET /calendar/outlook/list`
- [x] 3.5 Update `/calendar/status` for Outlook

### Phase 4: Backend Sync
- [x] 4.1 Extend `syncUserCalendar()` with Outlook branch
- [x] 4.2 Extend `autoAddToCalendar()` with Outlook branch

### Phase 5: Frontend
- [x] 5.1 Update AuthContext.tsx
- [x] 5.2 Update SettingsPage.tsx
- [x] 5.3 Update CalendarPicker.tsx types and endpoint
- [x] 5.4 Handle callback redirect (verify existing behavior)

### Phase 6: Validation
- [x] 6.1 Type-check frontend
- [x] 6.2 Build functions
- [x] 6.3 Update current-state docs
