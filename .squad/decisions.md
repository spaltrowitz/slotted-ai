# Decisions

> Canonical record of team decisions. Append-only. Scribe merges from inbox.

---

## Improvement Analysis (Beard, 2026-02-27)

**Summary:** Beard's full-stack codebase analysis identified 18 prioritized improvements:
- 6 Quick Wins (empty states, OAuth verification, counter-propose wiring, CORS hardening, token encryption, invite route fix)
- 7 Medium Lifts (backend split, integration tests, GDPR features, email fallback, onboarding pipeline, Lighthouse optimization, algorithm transparency)
- 5 Large Initiatives (two-way calendar sync, recurring commitments, SMS bridge, ML preference learning, couple/family mode)

**Key Findings:**
- Backend monolith (8,371 lines) is the #1 velocity blocker
- Empty states + onboarding pipeline are the #1 UX blockers (drop-off moments)
- OAuth tokens in plaintext (security liability)
- InvitePage route missing (growth blocker — invite links 404)

**Immediate:** All 6 Quick Wins (low risk, high impact)  
**Next sprint:** Backend split + integration tests (unblock velocity)  
**Following:** GDPR + email fallback + onboarding pipeline  
**V2:** Two-way sync + recurring commitments
