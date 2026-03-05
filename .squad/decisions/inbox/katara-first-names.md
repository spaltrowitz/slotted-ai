# Decision: First-Name-Only Display Names

**Agent:** Katara (Frontend)
**Date:** 2026-07
**Status:** Implemented

## What
All user-facing display names across the frontend now show first name only (e.g., "Shari" instead of "Shari Paltrowitz").

## How
- New utility `getFirstName()` in `client/src/lib/utils.ts` — splits on space, returns first token, handles null/undefined/empty.
- Applied at every render site; full names remain in DB, API responses, and meetup-log payloads.
- Replaced all ad-hoc `.split(' ')[0]` patterns with the centralized utility.

## Why
- Friendlier, more casual tone — matches Slotted's social product identity.
- Privacy improvement — less personal info shown on screen at a glance.

## Affected Files
DashboardPage, FriendsPage, InvitePage, EventSharePage, OnboardingPage, NotificationsPage, NotificationDropdown, FriendAvailability, GroupAvailability.
