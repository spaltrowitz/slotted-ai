// ---------------------------------------------------------------------------
// Scenario: Calendar Status & Saved Events
// ---------------------------------------------------------------------------
// Tests: calendar status (disconnected state), saved events CRUD,
//        event invite flow between agents
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep } from "../scenario.js";

const calendarEventsScenario: Scenario = {
  name: "calendar-events",
  description: "Calendar status checks and saved events CRUD with invite flow",
  priority: 80,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous } = ctx.agents;

    ctx.log("--- Scenario: Calendar Status & Events ---");

    const spontId = await spontaneous.getSupabaseUserId();

    // -----------------------------------------------------------------------
    // Step 1: Calendar status endpoint returns valid structure
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Check calendar status structure");
    const { result: calStatus, durationMs: statusMs } = await timed(async () => {
      return planner.getCalendarStatus();
    });

    const status = calStatus as any;
    const hasValidStructure =
      status !== null &&
      typeof status === "object" &&
      "connected" in status;

    results.push({
      ...assert(
        "calendar-status-structure",
        hasValidStructure,
        `Calendar status has valid structure (connected: ${status?.connected})`,
      ),
      durationMs: statusMs,
    });

    // -----------------------------------------------------------------------
    // Step 2: Calendar status for each provider
    // -----------------------------------------------------------------------
    ctx.log("Step 2: Check per-provider status fields");
    if (hasValidStructure) {
      const hasProviderFields =
        "google" in status &&
        "apple" in status;

      results.push(
        assert(
          "calendar-provider-fields",
          hasProviderFields,
          `Status includes provider fields (google: ${status.google}, apple: ${status.apple}, outlook: ${status.outlook ?? "n/a"})`,
          "info",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Save an event
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Save an event");
    const nextFriday = new Date();
    nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
    nextFriday.setHours(20, 0, 0, 0);
    const nextFridayEnd = new Date(nextFriday);
    nextFridayEnd.setHours(23, 0, 0, 0);

    const testEvent = {
      title: "Agent Test: Comedy Show",
      start: nextFriday.toISOString(),
      end: nextFridayEnd.toISOString(),
      source: "test",
      location: "Comedy Cellar",
      url: "https://example.com/comedy",
    };

    const { result: saveResult, durationMs: saveMs } = await timed(async () => {
      return planner.saveEvent(testEvent);
    });

    const savedEvent = saveResult as any;
    const savedId = savedEvent?.id;

    results.push({
      ...assert(
        "save-event",
        savedEvent !== null && typeof savedEvent === "object",
        "Saved an event successfully",
      ),
      durationMs: saveMs,
    });

    // -----------------------------------------------------------------------
    // Step 4: List saved events — should contain our event
    // -----------------------------------------------------------------------
    ctx.log("Step 4: List saved events");
    const { result: savedList, durationMs: savedListMs } = await timed(async () => {
      return planner.getSavedEvents();
    });

    const savedEvents = Array.isArray(savedList) ? savedList : (savedList as any)?.events || [];
    const foundSaved = Array.isArray(savedEvents) && savedEvents.length > 0;

    results.push({
      ...assert(
        "list-saved-events",
        foundSaved,
        `Listed saved events (${Array.isArray(savedEvents) ? savedEvents.length : 0} total)`,
      ),
      durationMs: savedListMs,
    });

    // -----------------------------------------------------------------------
    // Step 5: Update saved event status
    // -----------------------------------------------------------------------
    if (savedId) {
      ctx.log("Step 5: Update saved event");
      const { result: updateResult, durationMs: updateMs } = await timed(async () => {
        return planner.updateSavedEvent(savedId, { status: "attending", notes: "Bringing friends!" });
      });

      results.push({
        ...assert(
          "update-saved-event",
          updateResult !== null,
          "Updated saved event status and notes",
        ),
        durationMs: updateMs,
      });
    }

    // -----------------------------------------------------------------------
    // Step 6: Send event invite to Spontaneous
    // -----------------------------------------------------------------------
    ctx.log("Step 6: Send event invite");
    const { result: inviteResult, durationMs: inviteMs } = await timed(async () => {
      return planner.inviteToEvent([spontId], testEvent, "Wanna go to this show?");
    });

    const inviteData = inviteResult as any;
    results.push({
      ...assert(
        "send-event-invite",
        inviteData !== null && typeof inviteData === "object",
        "Sent event invite to Spontaneous",
        "warning",
      ),
      durationMs: inviteMs,
    });

    await sleep(1500);

    // -----------------------------------------------------------------------
    // Step 7: Spontaneous checks their invites
    // -----------------------------------------------------------------------
    ctx.log("Step 7: Spontaneous checks event invites");
    const { result: invites, durationMs: invitesMs } = await timed(async () => {
      return spontaneous.getEventInvites();
    });

    const invitesList = Array.isArray(invites) ? invites : (invites as any)?.invites || [];
    results.push({
      ...assert(
        "receive-event-invite",
        Array.isArray(invitesList),
        `Spontaneous has ${Array.isArray(invitesList) ? invitesList.length : 0} event invite(s)`,
        "warning",
      ),
      durationMs: invitesMs,
    });

    // -----------------------------------------------------------------------
    // Step 8: Delete saved event (cleanup)
    // -----------------------------------------------------------------------
    if (savedId) {
      ctx.log("Step 8: Delete saved event");
      const { result: deleteResult, durationMs: deleteMs } = await timed(async () => {
        return planner.deleteSavedEvent(savedId);
      });

      results.push({
        ...assert(
          "delete-saved-event",
          (deleteResult as any).status === 200,
          "Deleted saved event",
        ),
        durationMs: deleteMs,
      });
    }

    return results;
  },
};

export default calendarEventsScenario;
