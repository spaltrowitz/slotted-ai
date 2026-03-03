# Research: Outlook Calendar Integration

## Current Calendar Architecture

### Providers Implemented
1. **Google Calendar** — Full OAuth 2.0 via `googleapis` library. Token auto-refresh, event CRUD, watch channels (scaffolded). Scopes: `calendar.readonly`, `calendar.events.readonly`, `calendar.events`.
2. **Apple Calendar** — CalDAV via `tsdav` library. Basic auth with app-specific password. Event creation via iCal format. No real-time sync (polling only).

### Code Structure (functions/src/index.ts)
- **No abstraction layer** — each provider is handled via if/else branching
- `syncUserCalendar()` (~line 1523): checks `hasGoogle` and `hasApple` flags, branches to provider-specific logic, merges busy blocks into `availability` table
- `autoAddToCalendar()` (~line 169): tries Google first, falls back to Apple if Google fails/not connected
- OAuth routes are provider-specific: `/calendar/auth-url`, `/calendar/callback` for Google; `/calendar/apple/connect` for Apple

### Database Schema
- **`users` table**: stores credentials per provider (google_access_token, google_refresh_token, google_token_expires_at, apple_caldav_username, apple_caldav_password, apple_calendar_connected)
- **`user_calendars` table**: `source` column with CHECK constraint `IN ('google', 'apple')` — must be expanded
- **`availability` table**: provider-agnostic (no source column) — no changes needed
- **`meetup_participants`**: `google_event_id` column stores calendar event IDs (used for both Google and Apple despite the name)

### Frontend
- **AuthContext.tsx**: separate state flags per provider (`googleCalendarConnected`, `appleCalendarConnected`), separate connect/disconnect functions
- **SettingsPage.tsx**: repeats UI block per provider (Google section, Apple section)
- **CalendarPicker.tsx**: takes `source` prop ('google' | 'apple'), uses different list endpoints per source

## Microsoft Graph API for Outlook Calendar

### Authentication
- Uses **OAuth 2.0 Authorization Code Flow** via Microsoft identity platform
- Library: `@azure/msal-node` (Microsoft Authentication Library)
- Register app at [Azure Portal](https://portal.azure.com) → App Registrations
- Required: client ID, client secret, tenant ID (use "common" for multi-tenant)
- Redirect URI must be registered in Azure AD

### Required Scopes
- `Calendars.Read` — read user's calendars and events
- `Calendars.ReadWrite` — create/update/delete events
- `offline_access` — get refresh token for long-lived access
- `User.Read` — basic profile info

### Event CRUD
- **List calendars**: `GET /me/calendars`
- **List events**: `GET /me/calendars/{id}/events` or `GET /me/calendarView?startDateTime=...&endDateTime=...`
- **Create event**: `POST /me/calendars/{id}/events`
- **Update event**: `PATCH /me/events/{event-id}`
- **Delete event**: `DELETE /me/events/{event-id}`
- All via `https://graph.microsoft.com/v1.0/`

### Webhooks (Subscriptions)
- `POST /subscriptions` with resource `/me/events`, changeType `created,updated,deleted`
- Max expiration: ~4230 minutes (~3 days) — requires renewal (similar to Google's 7-day watch channels)
- Validation: Microsoft sends a validation token on subscription creation that must be echoed back
- Not implementing in this phase (matching Google's current state where webhooks are scaffolded but not wired)

### Token Refresh
- MSAL handles token caching and refresh automatically via `acquireTokenSilent()` / `acquireTokenByRefreshToken()`
- We store refresh_token in DB (same pattern as Google)
- Access tokens expire in ~1 hour

### Key Differences from Google
| Aspect | Google | Outlook |
|--------|--------|---------|
| Auth library | `googleapis` (built-in OAuth2) | `@azure/msal-node` |
| API client | `google.calendar()` | Direct fetch to Graph API (or `@microsoft/microsoft-graph-client`) |
| Calendar ID | email-like string | GUID |
| Event creation | `calendarId: "primary"` | POST to `/me/calendars/{id}/events` |
| Token refresh | Auto via oauth2.on("tokens") | MSAL `acquireTokenByRefreshToken()` |
| Webhook max TTL | 7 days | ~3 days |

## What Needs to Change

### Database
1. Add Outlook columns to `users` table: `outlook_access_token`, `outlook_refresh_token`, `outlook_token_expires_at`, `outlook_calendar_connected`
2. Update `user_calendars.source` CHECK constraint to include `'outlook'`

### Backend (functions/src/index.ts)
1. Add `@azure/msal-node` dependency
2. Create MSAL client helper functions (equivalent to `getOAuth2Client()` / `getAuthedCalendarClient()`)
3. Add Outlook OAuth routes: `/calendar/outlook/auth-url`, `/calendar/outlook/callback`
4. Add `/calendar/outlook/disconnect` route
5. Add `/calendar/outlook/list` route
6. Extend `syncUserCalendar()` with Outlook branch
7. Extend `autoAddToCalendar()` with Outlook fallback (after Google, before/alongside Apple)

### Frontend
1. Add `outlookCalendarConnected`, `connectOutlookCalendar`, `disconnectOutlookCalendar` to AuthContext
2. Add Outlook section to SettingsPage (between Google and Apple)
3. Update CalendarPicker to accept `source: 'outlook'`
4. Update CalendarInfo type to include `'outlook'`

### Environment Variables
- `MICROSOFT_CLIENT_ID` — from Azure AD app registration
- `MICROSOFT_CLIENT_SECRET` — from Azure AD app registration
- `MICROSOFT_REDIRECT_URI` — callback URL
- `MICROSOFT_TENANT_ID` — "common" for multi-tenant (personal + work/school accounts)
