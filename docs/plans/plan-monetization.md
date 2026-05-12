# Plan: Monetization Through Ads, Affiliates, and Marketing Events

## Goal

Create a monetization path for Slotted that does not require users to pay. The core app should stay free: users should be able to connect calendars, add friends, find mutual availability, propose hangouts, and confirm plans without payment.

The revenue strategy should be partner-funded, not user-funded:

- Affiliate or revenue-share links
- Sponsored but clearly labeled activity/event placements
- Partner-funded marketing events
- Aggregate-only business reporting

## Positioning

Slotted should not become an ad-supported social feed. The brand promise is trust: private calendars, private social energy, soft social dynamics, and low-friction planning.

The strongest monetization line:

> Slotted stays free for people because local venues, events, and activity partners pay when they help friends make plans.

## Principles

1. **Core scheduling stays free.** Never charge users to add friends, find time, RSVP, or keep plans on their calendar.
2. **No traditional display ads in intimate surfaces.** No banner ads on Dashboard, Friends, Notifications, Settings, calendar views, RSVP flows, or friend cards.
3. **Sponsored content must be useful.** Sponsored placements should answer "what should we do?" or "where should we go?", not interrupt scheduling.
4. **Always label paid placements.** Use "Sponsored" or "Partner" plainly.
5. **No sensitive targeting.** Do not target based on calendar contents, social battery, friend graph, relationship cadence, or availability patterns.
6. **Aggregate reporting only.** Partners can see impressions, clicks, saves, shares, and bookings. They cannot see individual identities, friendships, calendars, or energy states.
7. **Preserve the first aha moment.** A new user should experience invite -> mutual time -> proposed hangout before seeing monetized surfaces.

## Recommended business model

### Primary model: Partner-funded activity discovery

Slotted monetizes when users want inspiration after choosing a person, group, city, date, or category.

Revenue sources:

| Source | How it works | Why it fits |
|---|---|---|
| Ticket affiliate links | Slotted earns commission when users buy tickets through event links | Already aligned with Event Search and event sharing |
| Reservation/booking referral | Slotted earns when users reserve restaurants, classes, or activities | Solves the "where should we meet?" problem |
| Sponsored event cards | Partners pay for labeled placement in event/activity discovery | Contextual without paywalling scheduling |
| Sponsored collections | Local guides include organic picks plus labeled sponsor slots | Feels editorial, not feed-like |
| Marketing events | Venues pay flat or performance fees for Slotted-powered group campaigns | Drives both revenue and user acquisition |

### Secondary model: Local partner packages

Create lightweight partner packages once usage clusters by city.

Example packages:

| Package | Buyer | Includes |
|---|---|---|
| Starter placement | Local venue/event | Labeled placement in relevant search/category results |
| City collection sponsor | Restaurant group, theater, activity brand | Sponsor slot in a themed guide like "low-effort weeknight hangs" |
| Slotted Night | Venue or community org | Branded landing page, invite flow, partner reporting |
| Family/playdate weekend | Kid-friendly venue, school/community sponsor | Family-friendly activity collection and group coordination CTA |

## Product surfaces

### Good monetization surfaces

1. **Events search results**
   - Add sponsored/affiliate cards only when the user is actively browsing events or activities.
   - Keep sponsored cards visually similar but clearly labeled.

2. **After selecting a friend or group**
   - Once a user has chosen who they want to see, show optional "Need an idea?" suggestions.
   - This fits the mental model: person first, plan second.

3. **After a meetup is confirmed**
   - Show optional next steps: "Make it dinner", "Get tickets", "Find something nearby."
   - This is high-intent and does not block scheduling.

4. **City/category collections**
   - Create non-feed pages like "Comedy this weekend", "Good for groups", "Rainy day plans", "Family-friendly Saturday."
   - Include organic and sponsored items with labels.

5. **Public event share pages**
   - If someone shares an event link, the landing page can include relevant affiliate links and "schedule with friends" CTA.

### Bad monetization surfaces

Avoid monetization in:

- Dashboard first-run state
- Friend list/cards
- Availability result list
- RSVP notifications
- Social Battery
- Settings
- Calendar sync prompts
- Error/empty states related to core scheduling

## Implementation phases

### Phase 1: Measurement foundation

Purpose: understand whether event/activity discovery can generate intent before selling anything.

Changes:

- Track outbound clicks from event cards.
- Track event saves/shares if not already covered.
- Track which surface produced the click: search, event share page, post-confirmation, collection.
- Add UTM-style metadata to outbound links where allowed.
- Keep analytics `slotted_` prefixed, consistent with existing analytics conventions.

Success signals:

- Users click event/ticket/reservation links after finding a time.
- Shared events produce invite or signup activity.
- Event discovery is used by active users, not just browsers.

### Phase 2: Affiliate MVP

Purpose: monetize existing event/ticket intent without introducing ad sales.

Changes:

- Add affiliate parameters to eligible outbound event/ticket links.
- Store provider, destination URL, event ID, source surface, and timestamp for attribution.
- Add a small disclosure near outbound links: "Slotted may earn from partner links."
- Do not reorder results based on commission yet.

Success signals:

- Affiliate clicks occur without hurting scheduling conversion.
- Users do not complain that the app feels ad-heavy.
- Event share pages produce organic signups.

### Phase 3: Sponsored placement experiment

Purpose: test whether labeled sponsored placements can be useful and trusted.

Changes:

- Add a `sponsored_placements` table or config-backed placement list.
- Support fields like title, venue, category, city, start/end date, image URL, destination URL, sponsor name, placement type, and active status.
- Render at most one sponsored item per relevant surface.
- Label every paid item as "Sponsored."
- Cap frequency per session/user.

Suggested first placement surfaces:

1. Events search results
2. Post-confirmation suggestion module
3. Themed city collection

Success signals:

- Sponsored click-through is comparable to organic activity cards.
- Scheduling completion is not reduced.
- No trust complaints from beta users.

### Phase 4: Partner-funded marketing events

Purpose: turn Slotted into an acquisition channel for local activities and communities.

Campaign concepts:

- **Slotted Night at [Venue]**: sponsor pays for a campaign that encourages users to bring a friend or group.
- **Comedy with Friends Weekend**: comedy club sponsors a city collection.
- **Double-Date Dinner Week**: restaurant group sponsors couples/group scheduling.
- **Playdate Saturday**: family-friendly venue sponsors household/group coordination.
- **Reconnect Week**: local partners sponsor low-effort hang ideas for people users have not seen recently, without revealing individual cadence to partners.

Changes:

- Create public campaign landing pages.
- Add campaign attribution to invite links and event clicks.
- Give partners aggregate reporting only.
- Use campaigns as acquisition loops: every campaign CTA should encourage inviting friends to schedule.

Success signals:

- Partner campaigns produce new users.
- Invited users complete the first scheduling loop.
- Partners see measurable clicks/bookings/attendance.

### Phase 5: Partner dashboard or manual reports

Purpose: make sponsorship repeatable.

Start manually:

- Monthly partner report as CSV or slide summary.
- Metrics: impressions, clicks, saves, shares, outbound bookings, invite-link signups, confirmed plans attributed to campaign.

Only build a dashboard later if partner demand exists.

## Data model considerations

If implemented, keep data collection minimal and purpose-specific.

Possible tables:

```sql
create table sponsored_placements (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null,
  title text not null,
  description text,
  city text,
  category text,
  image_url text,
  destination_url text not null,
  placement_type text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table monetization_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  placement_id uuid references sponsored_placements(id) on delete set null,
  event_type text not null,
  source_surface text not null,
  provider text,
  destination_url text,
  created_at timestamptz not null default now()
);
```

Privacy guardrail: `monetization_events` should not store calendar event details, social battery, friend names, friend graph edges, or raw availability windows.

## UX copy examples

Affiliate disclosure:

> Slotted may earn from partner links, but your calendar and friendships stay private.

Sponsored label:

> Sponsored

Post-confirmation module:

> Want to make it a plan?
> Here are a few easy ideas near you.

Campaign CTA:

> Bring a friend. Slotted finds the time.

Partner pitch:

> Slotted helps people turn "we should hang out" into real plans. Sponsor the moment when friends are choosing what to do.

## Partner targets

Start with partners that naturally map to friend/family plans:

- Comedy clubs
- Small theaters and music venues
- Restaurant groups
- Coffee shops
- Fitness studios
- Climbing gyms
- Museums
- Cooking/pottery/art classes
- Kid-friendly venues
- Alumni groups
- Coworking/community spaces
- Local newsletters and event curators

Avoid early partners that create trust issues:

- Data brokers
- Dating apps
- Work productivity vendors
- High-pressure sales experiences
- Anything that requires exposing personal schedules

## Metrics

Track product metrics and monetization metrics separately.

Product health:

- First scheduling loop completion
- Friend invites sent
- Friends connected
- Meetups proposed
- Meetups confirmed
- Weekly retention

Monetization:

- Sponsored impressions
- Sponsored clicks
- Affiliate outbound clicks
- Saves/shares
- Event share page conversion
- Campaign invite signups
- Campaign-attributed confirmed plans
- Partner repeat purchase

Guardrail metrics:

- Scheduling conversion before vs. after monetized surfaces
- Time to first meetup
- Unsubscribe/sign-out/account deletion
- Beta feedback mentioning ads, clutter, trust, or creepiness

## Trade-offs

| Decision | Upside | Risk | Mitigation |
|---|---|---|---|
| Keep users free | Maximizes adoption and friend-network growth | Revenue depends on partner demand | Start with affiliate links before custom ad sales |
| No banner ads | Protects brand trust | Slower revenue ramp than display ads | Use high-intent commerce moments instead |
| Sponsored activity cards | Natural fit for "what should we do?" | Could feel pay-to-rank | Label clearly, cap frequency, keep organic results |
| Partner events | Revenue + acquisition loop | Operationally manual | Start with 1 city and 1 repeatable campaign format |
| Aggregate reporting only | Protects privacy | Less targeting precision for sponsors | Sell contextual intent, not surveillance |

## Recommendation

Do not pursue generic ad revenue. Pursue **partner-funded activity discovery**:

1. Add measurement around event/activity clicks.
2. Add affiliate links where available.
3. Test one clearly labeled sponsored card surface.
4. Run one manual local marketing event or city collection.
5. Keep all core scheduling free and ad-free.

This gives Slotted revenue potential while strengthening, not weakening, the product: users get better ideas for what to do, partners reach high-intent friend groups, and Slotted avoids charging users for maintaining relationships.

## Todo list

- [ ] Confirm monetization principles and update `docs/09-business-plan.md` if this strategy replaces freemium.
- [ ] Audit current event outbound links and analytics events.
- [ ] Design affiliate-link attribution for Ticketmaster/SeatGeek/Eventbrite-style providers.
- [ ] Define privacy-safe monetization event tracking.
- [ ] Prototype one sponsored placement surface in Events search or post-confirmation suggestions.
- [ ] Draft a one-page partner pitch for local venues/events.
- [ ] Run one manual sponsor/campaign pilot before building a partner dashboard.
