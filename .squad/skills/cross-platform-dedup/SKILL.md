# Cross-Platform Event Deduplication

## When to Use
When aggregating results from multiple event APIs (SeatGeek, Ticketmaster, Eventbrite, etc.) that list the same events.

## Pattern
1. **Normalize titles** — strip city suffixes, parentheticals, articles, punctuation
2. **Normalize datetimes** — handle timezone inconsistencies (missing Z, UTC offsets)
3. **Match by title + time (±tolerance)** — 2hr window catches minor platform clock differences without merging matinee/evening
4. **Normalize venues separately** — Theatre/Theater variants, strip articles, compare via substring inclusion
5. **Merge, don't collapse** — each showtime stays separate; only same-performance cross-platform duplicates merge
6. **Preserve all ticket links** — merged entry has `urls[]` array with links to all platforms

## Key Gotchas
- SeatGeek appends " - New York" to titles; Ticketmaster doesn't
- SeatGeek datetime_utc lacks trailing Z; Ticketmaster includes it
- Same venue has different names across platforms ("The Hayes Theater" vs "Helen Hayes Theatre")
- Matinee (2pm) and evening (7pm) shows are 5 hours apart — must remain separate

## Implementation
`functions/src/index.ts` — `deduplicateEvents()`, `normalizeTitle()`, `normalizeVenue()`, `venuesMatch()`, `parseEventTime()`
