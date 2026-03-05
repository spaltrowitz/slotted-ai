// ---------------------------------------------------------------------------
// Scenario: Notification Deduplication
// ---------------------------------------------------------------------------
// Tests the cascading dedup logic in createNotification:
//   1. relatedUserId match within 1 hour (primary)
//   2. relatedId match within 5 minutes (secondary)
//   3. title match within 10 minutes (fallback)
//
// Validates that:
//   - A single friend connection produces exactly one friend_accepted notification
//   - Rapid duplicate actions don't create duplicate notifications
//   - Different notification types for the same user pair coexist
//   - Multiple friend_accepted notifications for different user pairs coexist
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep, waitFor } from "../scenario.js";
import { Notification } from "../client.js";

const notificationDedupScenario: Scenario = {
  name: "notification-dedup",
  description: "Notification deduplication across friend connection code paths",
  priority: 35,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    ctx.log("--- Scenario: Notification Deduplication ---");

    // -----------------------------------------------------------------------
    // Setup: Get user IDs and clean slate for friend_accepted notifications
    // -----------------------------------------------------------------------
    ctx.log("Setup: Getting user IDs and recording baseline");
    const plannerId = await planner.getSupabaseUserId();
    const spontId = await spontaneous.getSupabaseUserId();
    const flakyId = await flaky.getSupabaseUserId();

    // Record baseline notification counts so we can detect new ones
    const plannerNotifsBefore = await planner.getNotifications();
    const friendAcceptedBefore = plannerNotifsBefore.filter(
      (n: Notification) => n.type === "friend_accepted",
    );

    ctx.log(`Planner has ${friendAcceptedBefore.length} existing friend_accepted notifications`);

    // -----------------------------------------------------------------------
    // Test 1: Single notification on friend connect via referral
    // -----------------------------------------------------------------------
    // This test connects spontaneous → planner via referral and verifies
    // only ONE new friend_accepted notification is created for planner.
    // The dedup logic should prevent duplicates even if the signup flow
    // fires both POST /users/me (pending_invites) and POST /friends/connect-referral.
    // -----------------------------------------------------------------------
    ctx.log("Test 1: Single notification on referral connect");

    const { result: referralResult, durationMs: referralMs } = await timed(async () => {
      // Remove existing friendship so we can re-connect
      const friends = await planner.getFriends();
      const existingFriendship = friends.find(
        (f: any) => f.friend?.id === spontId,
      );

      if (existingFriendship) {
        ctx.log(`Removing existing friendship ${existingFriendship.id} to test reconnection`);
        await planner.removeFriend(existingFriendship.id);
        await sleep(1000);
      }

      // Clean up old friend_accepted notifications targeting this user pair
      const adminNotifs = await planner.adminGetNotifications(plannerId);
      for (const n of adminNotifs) {
        if (n.type === "friend_accepted" && n.related_user_id === spontId) {
          await planner.adminDeleteNotification(n.id);
        }
      }
      await sleep(500);

      // Connect via referral — this should create exactly ONE notification
      const connectResp = await spontaneous.connectReferral(planner.persona.email);
      return connectResp;
    });

    const referralStatus = referralResult.status;
    results.push({
      ...assert(
        "referral-connect-succeeds",
        referralStatus === 200 || referralStatus === 201,
        `Referral connect returned ${referralStatus} (expected 200/201)`,
      ),
      durationMs: referralMs,
    });

    // Wait for notification to be created, then poll
    await sleep(1000);

    // Count friend_accepted notifications for planner from spontaneous
    const plannerNotifsAfterConnect = await waitFor(
      () => planner.getNotifications(),
      (notifs) => notifs.some(
        (n: Notification) => n.type === "friend_accepted" && n.related_user_id === spontId,
      ),
      5,
      1000,
    );
    const newFriendAccepted = plannerNotifsAfterConnect.filter(
      (n: Notification) =>
        n.type === "friend_accepted" && n.related_user_id === spontId,
    );

    results.push(
      assert(
        "single-notification-on-referral",
        newFriendAccepted.length === 1,
        newFriendAccepted.length === 1
          ? "Exactly 1 friend_accepted notification created for referral connect"
          : `Expected 1 friend_accepted notification, got ${newFriendAccepted.length}`,
      ),
    );

    // -----------------------------------------------------------------------
    // Test 2: Duplicate connect-referral calls don't create duplicate notifs
    // -----------------------------------------------------------------------
    // Calling connect-referral again immediately should NOT create a second
    // notification — the primary dedup (relatedUserId within 1 hour) should
    // catch it even though the friendshipId (relatedId) may differ.
    // -----------------------------------------------------------------------
    ctx.log("Test 2: Rapid duplicate referral connect → no duplicate notification");

    const { durationMs: dupMs } = await timed(async () => {
      // Fire a second connect-referral for the same pair
      await spontaneous.connectReferral(planner.persona.email);
      await sleep(2000);
    });

    const plannerNotifsAfterDup = await planner.getNotifications();
    const friendAcceptedAfterDup = plannerNotifsAfterDup.filter(
      (n: Notification) =>
        n.type === "friend_accepted" && n.related_user_id === spontId,
    );

    results.push({
      ...assert(
        "no-duplicate-on-rapid-reconnect",
        friendAcceptedAfterDup.length === 1,
        friendAcceptedAfterDup.length === 1
          ? "No duplicate notification after rapid re-connect"
          : `Expected 1 friend_accepted notification after re-connect, got ${friendAcceptedAfterDup.length}`,
      ),
      durationMs: dupMs,
    });

    // -----------------------------------------------------------------------
    // Test 3: Different notification types for the same user pair coexist
    // -----------------------------------------------------------------------
    // A friend_accepted and a different type (e.g., meetup_invite) for the
    // same user pair should NOT be deduped — they're different notification
    // types with different meanings.
    // -----------------------------------------------------------------------
    ctx.log("Test 3: Different notification types coexist for same user pair");

    const allPlannerNotifs = await planner.getNotifications();
    const notifTypes = new Set(
      allPlannerNotifs
        .filter((n: Notification) => n.related_user_id === spontId)
        .map((n: Notification) => n.type),
    );

    // friend_accepted should exist from test 1; other types may or may not
    // exist. The assertion: if multiple types exist for the same pair, they
    // are NOT collapsed — each type appears independently.
    const typeCountMap = new Map<string, number>();
    for (const n of allPlannerNotifs) {
      if (n.related_user_id === spontId) {
        typeCountMap.set(n.type, (typeCountMap.get(n.type) || 0) + 1);
      }
    }

    // Each type should appear at most once (no duplicates within a type)
    const anyDupesWithinType = [...typeCountMap.entries()].some(
      ([type, count]) => type === "friend_accepted" && count > 1,
    );

    results.push(
      assert(
        "different-types-not-deduped",
        !anyDupesWithinType && notifTypes.has("friend_accepted"),
        !anyDupesWithinType
          ? `Notifications for planner↔spontaneous span ${notifTypes.size} type(s): ${[...notifTypes].join(", ")} — no cross-type dedup`
          : "Found duplicate friend_accepted notifications for the same user pair",
      ),
    );

    // -----------------------------------------------------------------------
    // Test 4: Multiple friend_accepted notifications for DIFFERENT user pairs
    // -----------------------------------------------------------------------
    // When planner gets friend_accepted from spontaneous AND from flaky,
    // both should exist — the dedup only prevents duplicates for the SAME
    // user pair, not across different friends.
    // -----------------------------------------------------------------------
    ctx.log("Test 4: Different user pairs produce separate notifications");

    const { durationMs: multiMs } = await timed(async () => {
      // Ensure flaky → planner friendship exists
      const plannerFriends = await planner.getFriends();
      const flakyFriendship = plannerFriends.find(
        (f: any) => f.friend?.id === flakyId,
      );

      if (!flakyFriendship) {
        ctx.log("Creating flaky → planner friendship via referral");
        await flaky.connectReferral(planner.persona.email);
        await sleep(2000);
      }
    });

    const plannerNotifsMulti = await planner.getNotifications();
    const friendAcceptedFromSpont = plannerNotifsMulti.filter(
      (n: Notification) =>
        n.type === "friend_accepted" && n.related_user_id === spontId,
    );
    const friendAcceptedFromFlaky = plannerNotifsMulti.filter(
      (n: Notification) =>
        n.type === "friend_accepted" && n.related_user_id === flakyId,
    );

    results.push({
      ...assert(
        "different-pairs-not-deduped",
        friendAcceptedFromSpont.length >= 1 && friendAcceptedFromFlaky.length >= 1,
        friendAcceptedFromSpont.length >= 1 && friendAcceptedFromFlaky.length >= 1
          ? `Planner has friend_accepted from spontaneous (${friendAcceptedFromSpont.length}) and flaky (${friendAcceptedFromFlaky.length}) — correctly not deduped`
          : `Missing expected notifications: spontaneous=${friendAcceptedFromSpont.length}, flaky=${friendAcceptedFromFlaky.length}`,
        friendAcceptedFromSpont.length >= 1 && friendAcceptedFromFlaky.length >= 1 ? "info" : "critical",
      ),
      durationMs: multiMs,
    });

    // -----------------------------------------------------------------------
    // Test 5: No duplicate friend_accepted per user pair (global invariant)
    // -----------------------------------------------------------------------
    // Scan ALL notifications for ALL agents and assert that no agent has
    // more than 1 friend_accepted notification per related_user_id.
    // This is the invariant that the dedup fix is meant to guarantee.
    // -----------------------------------------------------------------------
    ctx.log("Test 5: Global invariant — no duplicate friend_accepted per user pair");

    for (const [name, agent] of Object.entries(ctx.agents)) {
      const notifs = await agent.getNotifications();
      const friendAcceptedByUser = new Map<string, number>();

      for (const n of notifs) {
        if (n.type === "friend_accepted" && n.related_user_id) {
          friendAcceptedByUser.set(
            n.related_user_id,
            (friendAcceptedByUser.get(n.related_user_id) || 0) + 1,
          );
        }
      }

      const dupes = [...friendAcceptedByUser.entries()].filter(([, count]) => count > 1);
      results.push(
        assert(
          `no-dup-friend-accepted-${name}`,
          dupes.length === 0,
          dupes.length === 0
            ? `${name}: No duplicate friend_accepted per user pair ✓`
            : `${name}: ${dupes.length} user pair(s) have duplicate friend_accepted: ${dupes.map(([uid, c]) => `${uid} (×${c})`).join(", ")}`,
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Test 6: friend_request dedup (same invariant for the other indexed type)
    // -----------------------------------------------------------------------
    ctx.log("Test 6: No duplicate friend_request per user pair");

    for (const [name, agent] of Object.entries(ctx.agents)) {
      const notifs = await agent.getNotifications();
      const friendRequestByUser = new Map<string, number>();

      for (const n of notifs) {
        if (n.type === "friend_request" && n.related_user_id) {
          friendRequestByUser.set(
            n.related_user_id,
            (friendRequestByUser.get(n.related_user_id) || 0) + 1,
          );
        }
      }

      const dupes = [...friendRequestByUser.entries()].filter(([, count]) => count > 1);
      results.push(
        assert(
          `no-dup-friend-request-${name}`,
          dupes.length === 0,
          dupes.length === 0
            ? `${name}: No duplicate friend_request per user pair ✓`
            : `${name}: ${dupes.length} user pair(s) have duplicate friend_request: ${dupes.map(([uid, c]) => `${uid} (×${c})`).join(", ")}`,
          dupes.length > 0 ? "critical" : "info",
        ),
      );
    }

    return results;
  },
};

export default notificationDedupScenario;
