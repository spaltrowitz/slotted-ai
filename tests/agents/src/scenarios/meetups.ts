// ---------------------------------------------------------------------------
// Scenario: Meetup Lifecycle
// ---------------------------------------------------------------------------
// Tests: create meetup → invite notifications → RSVP → counter-propose →
//        decline → verify notification filtering → mark didn't happen
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep, waitFor } from "../scenario.js";

const meetupsScenario: Scenario = {
  name: "meetups",
  description: "Meetup proposal, RSVP, counter-propose, and notification correctness",
  priority: 20,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    ctx.log("--- Scenario: Meetup Lifecycle ---");

    // Get Supabase user IDs
    const plannerId = await planner.getSupabaseUserId();
    const spontId = await spontaneous.getSupabaseUserId();
    const flakyId = await flaky.getSupabaseUserId();

    // -----------------------------------------------------------------------
    // Step 1: Planner creates a meetup with Spontaneous
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Planner proposes a meetup with Spontaneous");

    // Schedule for tomorrow 7pm
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    const endTime = new Date(tomorrow);
    endTime.setHours(21, 0, 0, 0);

    const { result: meetupResult, durationMs: createMs } = await timed(async () => {
      return planner.createMeetup({
        friendIds: [spontId],
        title: "Agent Test: Dinner at the spot",
        startTime: tomorrow.toISOString(),
        endTime: endTime.toISOString(),
        location: "West Village",
        activity: "dinner",
      });
    });

    results.push({
      ...assert(
        "create-meetup",
        meetupResult !== null && typeof meetupResult === "object",
        "Planner successfully created a meetup proposal",
      ),
      durationMs: createMs,
    });

    const meetupId = (meetupResult as any)?.id || (meetupResult as any)?.meetup?.id;
    ctx.state.testMeetupId = meetupId;

    await sleep(1000);

    // -----------------------------------------------------------------------
    // Step 2: Spontaneous should get a meetup_request notification
    // -----------------------------------------------------------------------
    ctx.log("Step 2: Checking Spontaneous's meetup_request notification");
    const spontNotifs = await waitFor(
      () => spontaneous.getNotifications(),
      (notifs) => notifs.some((n) => n.type === "meetup_request"),
      5,
      1000,
    );
    const meetupReqNotif = spontNotifs.find(
      (n) => n.type === "meetup_request",
    );
    results.push(
      assert(
        "meetup-request-notification",
        !!meetupReqNotif,
        "Spontaneous received a meetup_request notification",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 3: Check for duplicate meetup notifications
    // -----------------------------------------------------------------------
    const meetupReqNotifs = spontNotifs.filter((n) => n.type === "meetup_request");
    results.push(
      assert(
        "no-duplicate-meetup-request",
        meetupReqNotifs.length <= 1,
        `Spontaneous has ${meetupReqNotifs.length} meetup_request notification(s) (expected ≤ 1)`,
        meetupReqNotifs.length > 1 ? "critical" : "info",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 4: Flaky should NOT get a notification (not invited)
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Verifying Flaky has no meetup notification");
    const flakyNotifs = await flaky.getNotifications();
    const flakyMeetupNotif = flakyNotifs.find(
      (n) => n.type === "meetup_request" && n.related_id === meetupId,
    );
    results.push(
      assert(
        "flaky-no-meetup-notification",
        !flakyMeetupNotif,
        "Flaky did NOT receive a meetup notification (correctly excluded)",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 5: Spontaneous accepts the meetup
    // -----------------------------------------------------------------------
    if (meetupId) {
      ctx.log("Step 5: Spontaneous accepts the meetup");
      const { result: rsvpResult, durationMs: rsvpMs } = await timed(async () => {
        return spontaneous.rsvpMeetup(meetupId, "accepted");
      });
      results.push({
        ...assert(
          "accept-meetup",
          rsvpResult !== null,
          "Spontaneous successfully accepted the meetup",
        ),
        durationMs: rsvpMs,
      });

      await sleep(1000);

      // Step 6: Planner should get a meetup_confirmed notification
      ctx.log("Step 6: Checking Planner's meetup_confirmed notification");
      const plannerNotifs = await waitFor(
        () => planner.getNotifications(),
        (notifs) => notifs.some((n) => n.type === "meetup_confirmed" && n.related_id === meetupId),
        5,
        1000,
      );
      const confirmedNotif = plannerNotifs.find(
        (n) => n.type === "meetup_confirmed" && n.related_id === meetupId,
      );
      results.push(
        assert(
          "meetup-confirmed-notification",
          !!confirmedNotif,
          "Planner received a meetup_confirmed notification",
        ),
      );

      // Step 7: The meetup_request should be hidden since confirmed exists
      const staleRequest = plannerNotifs.find(
        (n) => n.type === "meetup_request" && n.related_id === meetupId,
      );
      results.push(
        assert(
          "stale-request-hidden",
          !staleRequest,
          "meetup_request notification is hidden after confirmation (no stale notifs)",
          "warning",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Step 8: Create a 3-person meetup for group testing
    // -----------------------------------------------------------------------
    ctx.log("Step 8: Planner creates a 3-person meetup");
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(12, 0, 0, 0);
    const nextWeekEnd = new Date(nextWeek);
    nextWeekEnd.setHours(14, 0, 0, 0);

    const groupMeetup = await planner.createMeetup({
      friendIds: [spontId, flakyId],
      title: "Agent Test: Group brunch",
      startTime: nextWeek.toISOString(),
      endTime: nextWeekEnd.toISOString(),
      location: "Park Slope",
      activity: "brunch",
    });

    const groupMeetupId = (groupMeetup as any)?.id || (groupMeetup as any)?.meetup?.id;
    ctx.state.groupMeetupId = groupMeetupId;

    results.push(
      assert(
        "create-group-meetup",
        groupMeetup !== null,
        "Created a 3-person group meetup",
      ),
    );

    await sleep(1000);

    // -----------------------------------------------------------------------
    // Step 9: Spontaneous accepts, Flaky declines
    // -----------------------------------------------------------------------
    if (groupMeetupId) {
      ctx.log("Step 9: Spontaneous accepts, Flaky declines the group meetup");
      await spontaneous.rsvpMeetup(groupMeetupId, "accepted");
      await flaky.rsvpMeetup(groupMeetupId, "declined");

      await sleep(1000);

      // Step 10: After declining, Flaky should not see meetup notifications for this meetup
      ctx.log("Step 10: Verifying Flaky's notifications are filtered after declining");
      const flakyNotifsAfter = await flaky.getNotifications();
      const flakyGroupNotif = flakyNotifsAfter.find(
        (n) =>
          ["meetup_request", "meetup_confirmed"].includes(n.type) &&
          n.related_id === groupMeetupId,
      );
      results.push(
        assert(
          "declined-meetup-notifications-hidden",
          !flakyGroupNotif,
          "Flaky's meetup notifications are hidden after declining",
          "warning",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Step 11: Verify meetup lists are correct for each agent
    // -----------------------------------------------------------------------
    ctx.log("Step 11: Verifying meetup lists");
    const plannerMeetups = await planner.getMeetups();
    const spontMeetups = await spontaneous.getMeetups();
    const flakyMeetups = await flaky.getMeetups();

    results.push(
      assert(
        "planner-sees-meetups",
        plannerMeetups.length >= 1,
        `Planner sees ${plannerMeetups.length} meetup(s)`,
      ),
    );
    results.push(
      assert(
        "spontaneous-sees-meetups",
        spontMeetups.length >= 1,
        `Spontaneous sees ${spontMeetups.length} meetup(s)`,
      ),
    );

    return results;
  },
};

export default meetupsScenario;
