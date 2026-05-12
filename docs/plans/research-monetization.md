# Research: Monetization Without User Payments

## Question

How could Slotted earn money through ad revenue, affiliate revenue, or marketing events without expecting users to pay?

## Relevant product context

Slotted is positioned as a privacy-first social scheduling layer, not a work scheduler, dating app, social feed, or event hosting platform. Its core loop is:

1. Connect calendar
2. Add friends or family
3. Find mutual availability
4. Propose a hangout
5. Confirm and add to calendar

The current app already includes event discovery through Ticketmaster and SeatGeek, location-aware event search, event sharing with friends, group availability, friend groups, hangout logging, and calendar auto-add. The data-flow docs also list Eventbrite, Meetup, and NYC Open Data as event discovery sources.

## Existing monetization notes

`docs/09-business-plan.md` currently says beta should remain free and lists future options: freemium, network-based pricing, affiliate revenue, and SMS/notification tiers. It also explicitly says "What we will NOT do: Show ads" because ads can break the intimate, trust-based experience.

The user's current direction changes the monetization constraint: users should not be expected to pay. That makes freemium and paid notification tiers poor fits for the current strategy, while affiliate revenue, sponsored activity discovery, venue partnerships, and marketing events become the natural paths.

## User and market signals

Beta feedback includes a direct signal that sponsorships, integrated advertising from entertainment, food, and partnerships could fit the product. Other beta feedback validates group coordination, family/playdate coordination, and activity inspiration as meaningful use cases.

The strongest monetizable surfaces are not raw ads. They are moments when the user already needs an idea or place:

- "What should we do?"
- "Where should we meet?"
- "Which event should we share?"
- "We found a time; now book the plan."
- "A parent group/friend group wants a low-friction activity."

## Important constraints

Slotted's differentiator is trust. Any monetization must protect:

- Calendar privacy
- Social battery privacy
- Friend graph privacy
- Soft social dynamics
- The "AI is invisible infrastructure" principle
- The core scheduling loop

This means Slotted should avoid:

- Display ad banners in the Dashboard, Friends page, Notifications, or scheduling flow
- Selling or sharing individual-level calendar, battery, friendship, or availability data
- Retargeting users based on sensitive social behavior
- Paywalls that block friend scheduling
- "Sponsored because AI recommends it" language
- Anything that makes the app feel like a feed

## Best-fit monetization categories

### 1. Affiliate and revenue-share links

Slotted can earn when users buy event tickets, book a reservation, reserve a class, or purchase an activity through partner links. This aligns with the existing Events feature and planned Activity Booking Integrations.

Best categories:

- Event tickets: Ticketmaster, SeatGeek, Eventbrite, comedy clubs, theaters, sports
- Restaurants and reservations: OpenTable, Resy, SevenRooms, local restaurant groups
- Activities: fitness classes, pottery, cooking classes, museums, tours, escape rooms, bowling, climbing gyms
- Gifts or occasions later: birthday gifts, flowers, cards, experience gifts

Why it fits:

- Users are already trying to decide what to do.
- The experience can remain free.
- Revenue happens around optional commerce, not core scheduling.

### 2. Sponsored event/activity placements

Slotted can show clearly labeled sponsored activity cards in event discovery, search results, or post-confirmation suggestions.

Good surfaces:

- Events search results
- "Need an idea?" after selecting a friend or group
- Post-confirmation "make it a plan" suggestions
- City/category landing pages
- Seasonal collections like "Mother's Day brunch ideas" or "rainy day hangs"

Bad surfaces:

- Dashboard first-run experience
- Friend cards
- Calendar/availability list
- RSVP notification cards
- Social battery/settings

Why it fits:

- Sponsored cards can be contextual without using sensitive targeting.
- It supports entertainment, food, and local business partnerships.
- It can be capped so the product does not become an ad feed.

### 3. Partner-funded marketing events

Slotted can partner with venues, clubs, restaurants, coworking communities, alumni groups, schools, parent groups, or activity businesses to run "Slotted Nights" or group coordination campaigns.

Examples:

- A comedy club sponsors "Bring a friend night"
- A climbing gym sponsors "Find your next belay buddy"
- A restaurant group sponsors "Double-date dinner week"
- A school PTA sponsors "playdate weekend"
- A museum sponsors "friends and family day"
- A coworking space sponsors "reconnect after work" programming

Revenue models:

- Flat sponsorship fee
- Per-registration fee
- Per-ticket affiliate commission
- Venue package fee for inclusion in city guides
- Co-marketing fee for branded landing page + analytics summary

Why it fits:

- It monetizes the behavior Slotted creates: small-group social plans.
- It creates acquisition loops because every event requires inviting friends.
- It does not require users to pay for the app.

### 4. Local business lead generation

Slotted can provide businesses with opted-in demand signals in aggregate: clicks, saves, shares, and bookings generated by sponsored placements or city guides.

Important: reporting should be aggregate-only. Do not expose who is free, who has a low social battery, who is friends with whom, or calendar-derived timing patterns.

Potential reports:

- Sponsored card impressions
- Click-throughs
- Saves/shares
- Bookings or ticket purchases
- City/category demand
- Anonymous group size distribution

### 5. Sponsored collections and editorial packages

Instead of ad banners, Slotted can create lightweight editorial collections:

- "Best low-effort weeknight hangs"
- "Good first group outing ideas"
- "Indoor plans for rainy weekends"
- "Family-friendly Saturday plans"
- "Long-distance call ideas"
- "Free things to do this weekend"

Some collections can be organic; some can include labeled sponsor slots. This keeps monetization aligned with usefulness.

## Strategic tension: Events were previously challenged

The product strategy review argues that Events can distract from the core scheduling loop, especially on Dashboard and early user sessions. That critique still matters.

The monetization implication is:

- Do not put sponsored events on the Dashboard for new users.
- Do not make Events the core product.
- Use event/activity monetization only after the user has picked a person/group or searched for ideas.
- Keep the first aha moment pure: invite friend, find time, book.

## Recommended direction

The best model is not generic ad revenue. It is partner-funded activity discovery:

1. Keep Slotted free for users.
2. Do not show traditional display ads.
3. Start with affiliate links for tickets/reservations/activities.
4. Add clearly labeled sponsored placements in event/activity discovery.
5. Run partner-funded local marketing events once there is enough city-level usage.
6. Report only aggregate performance metrics to partners.

This preserves the trust story while giving Slotted a path to revenue from the businesses that benefit when friends make plans.
