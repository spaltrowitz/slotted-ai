# Slotted — Launch Readiness Checklist

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | May 7, 2026 |
| **Purpose** | Go/No-Go checklist for expanding beyond private beta |
| **How to use** | Mark each item ✅ Ready / ⚠️ Needs work / ❌ Blocking. Items marked ❌ must be resolved before launch. |

---

## 1. Core Features

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1.1 | Google Calendar sync (webhooks + two-way) | ✅ | Built and working |
| 1.2 | Apple Calendar connect (CalDAV) | ✅ | Built and working |
| 1.3 | Outlook Calendar connect (Microsoft Graph) | ✅ | Built and working |
| 1.4 | Social Battery (internal only, hidden from friends) | ✅ | Privacy-first design |
| 1.5 | 1:1 availability matching | ✅ | Built and working |
| 1.6 | Multi-friend / group availability matching | ✅ | Built and working |
| 1.7 | Meetup booking & RSVP | ✅ | Built and working |
| 1.8 | Web push notifications | ✅ | FCM implemented |
| 1.9 | Email notification fallback | ⚠️ | Scaffold built — scheduled function finds unread notifications >24h, ready for SendGrid/SES plug-in |
| 1.10 | Counter-propose flow (accept counter-proposals) | ✅ | `POST /meetups/:id/accept-counter-propose` endpoint built |
| 1.11 | Auto-add to calendar on acceptance | ✅ | Built for confirmed meetups |
| 1.12 | Hangout logging | ✅ | Built and working |
| 1.13 | Settings & privacy controls | ✅ | Built and working |
| 1.14 | Events discovery | ✅ | Built and working |
| 1.15 | SMS bridge for non-Slotted users | ⚠️ | "Coming soon" note added to invite flow — full SMS deferred to V1.1 |

---

## 2. Onboarding & First Experience

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | Onboarding completes in < 2 minutes | | Run with a new test user |
| 2.2 | Value prop clear within 5 seconds of landing page | | Test with 5 strangers |
| 2.3 | First friend invite flow is frictionless | | |
| 2.4 | New user → first proposed meetup takes < 5 taps | | |

---

## 3. Legal & Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | Privacy Policy page | ✅ | Built |
| 3.2 | Terms of Service page | ✅ | Built |
| 3.3 | Data export (GDPR/CCPA) | ✅ | `GET /users/me/export` + download button in Settings |
| 3.4 | Account deletion (GDPR/CCPA) | ✅ | `DELETE /users/me/delete-account` + UI in Settings with double confirmation |
| 3.5 | Cookie/tracking consent | | Review if needed |

---

## 4. Technical Quality

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | Client typecheck passes (`tsc --noEmit`) | | Run before launch |
| 4.2 | Functions build passes | | Run before launch |
| 4.3 | CI pipeline validates PRs (build + lint + typecheck) | ✅ | Fixed in squad-ci.yml |
| 4.4 | Unit test coverage for critical paths | ⚠️ | Test framework needed — zero unit tests currently |
| 4.5 | E2E test agents pass | | Run full scenario suite |
| 4.6 | No console errors in production | | Check browser console |
| 4.7 | Error tracking (Firebase Performance + Analytics) | ✅ | Performance Monitoring + global error/crash reporting via Analytics |
| 4.8 | Production deployment tested | | Deploy to staging first |
| 4.9 | Database secrets not in Git | ⚠️ | `.env` files were committed — rotate credentials |

---

## 5. Performance & PWA

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | Lighthouse Performance score ≥ 80 | | Run audit |
| 5.2 | Lighthouse Accessibility score ≥ 90 | | Run audit |
| 5.3 | Lighthouse Best Practices score ≥ 90 | | Run audit |
| 5.4 | PWA installable on iOS and Android | ✅ | Install prompt built |
| 5.5 | Service worker caches critical assets | ✅ | vite-plugin-pwa configured |
| 5.6 | App works offline (graceful degradation) | | Test with network disabled |

---

## 6. Accessibility

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | Touch targets ≥ 44×44px on all interactive elements | ⚠️ | Some buttons too small — fix in progress |
| 6.2 | Color contrast meets WCAG AA (4.5:1 body, 3:1 large) | | Run contrast checker |
| 6.3 | Keyboard navigation works through entire app | ⚠️ | Needs testing and fixes |
| 6.4 | Screen reader compatible (ARIA labels) | | Test with VoiceOver |
| 6.5 | Empty states have intentional design | | Review all pages |
| 6.6 | Skeleton loaders for async content | | Review loading states |

---

## 7. UX Audit

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | Full UX audit completed (see `10-ux-audit-checklist.md`) | ✅ | Code-based audit complete: 63 pass, 14 needs work, 5 failing, 17 need manual verify |
| 7.2 | Beta tester feedback addressed | ⚠️ | Some items fixed, some pending |
| 7.3 | Notification deduplication verified | ✅ | 60-second dedup added |
| 7.4 | Soft social language used everywhere | ⚠️ | Cancel reasons need softer language |

---

## 8. Product Design Principles Check

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 8.1 | Privacy-first: No calendar/battery/activity visible to others | ✅ | |
| 8.2 | Soft social dynamics: No "decline"/"rejected" language | ⚠️ | Review cancel reasons |
| 8.3 | AI is invisible infrastructure: No "AI recommended" badges | ✅ | |
| 8.4 | Reduce friction at moments of excitement | ✅ | Auto-add to calendar |
| 8.5 | No social pressure: No status/count displays | ✅ | |

---

## Summary — Launch Blockers

| # | Blocker | Priority | Effort |
|---|---------|----------|--------|
| 1 | Plug in email service (SendGrid/SES) for notification fallback | P2 | ~4 hours |
| 2 | Run Lighthouse + manual device testing (17 items marked 🔍) | P2 | ~2 hours |

## Known Limitations (Acceptable for V1)

- No native iOS/Android apps (PWA only)
- ICS calendar export not built (deep links cover most cases)
- No Couple Mode (V2 feature)
- No location-based activity suggestions (V2 feature)
- Calendar-native users only (manual-only users underserved)
