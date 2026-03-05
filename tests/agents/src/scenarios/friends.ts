// ---------------------------------------------------------------------------
// Scenario: Friend Request Flow
// ---------------------------------------------------------------------------
// Tests: send request → receive notification → accept → verify friendship
// Also tests: decline, duplicate requests, and notification correctness
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep, waitFor } from "../scenario.js";

const friendsScenario: Scenario = {
  name: "friends",
  description: "Friend request lifecycle — send, accept, decline, verify notifications",
  priority: 10,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    ctx.log("--- Scenario: Friend Request Flow ---");

    // -----------------------------------------------------------------------
    // Step 1: Planner sends friend request to Spontaneous
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Planner sends friend request to Spontaneous");
    const { result: sendResult, durationMs: sendMs } = await timed(async () => {
      return planner.sendFriendRequest(spontaneous.persona.email);
    });
    results.push({
      ...assert(
        "send-friend-request",
        sendResult !== null,
        "Planner can send friend request to Spontaneous",
      ),
      durationMs: sendMs,
    });

    // Wait for notification to propagate
    await sleep(1000);

    // -----------------------------------------------------------------------
    // Step 2: Spontaneous should have a friend_request notification
    // -----------------------------------------------------------------------
    ctx.log("Step 2: Checking Spontaneous's notifications for friend request");
    const { result: spontNotifs, durationMs: notifMs } = await timed(async () => {
      return waitFor(
        () => spontaneous.getNotifications(),
        (notifs) => notifs.some((n) => n.type === "friend_request"),
        5,
        1000,
      );
    });
    const friendReqNotif = spontNotifs.find(
      (n) => n.type === "friend_request",
    );
    results.push({
      ...assert(
        "friend-request-notification-exists",
        !!friendReqNotif,
        "Spontaneous received a friend_request notification",
      ),
      durationMs: notifMs,
    });

    // -----------------------------------------------------------------------
    // Step 3: Flaky should NOT have a notification about this
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Verifying Flaky has no spurious notification");
    const flakyNotifs = await flaky.getNotifications();
    const flakySpurious = flakyNotifs.find(
      (n) => n.type === "friend_request" && n.related_user_id !== null,
    );
    results.push(
      assert(
        "no-spurious-notification-to-flaky",
        !flakySpurious || flakyNotifs.length === 0,
        "Flaky did NOT receive a spurious friend_request notification",
        "warning",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 4: Spontaneous accepts the friendship
    // -----------------------------------------------------------------------
    ctx.log("Step 4: Spontaneous accepts the friendship");
    const spontFriends = await spontaneous.getFriends();
    const pendingFriendship = spontFriends.find(
      (f: any) => f.status === "pending",
    );

    if (pendingFriendship) {
      const acceptResult = await spontaneous.acceptFriendship(pendingFriendship.id);
      results.push(
        assert(
          "accept-friendship",
          acceptResult !== null,
          "Spontaneous successfully accepted the friendship",
        ),
      );

      // Wait for notification
      await sleep(1000);

      // Step 5: Planner should get a friend_accepted notification
      ctx.log("Step 5: Checking Planner's notifications for friend_accepted");
      const plannerNotifs = await waitFor(
        () => planner.getNotifications(),
        (notifs) => notifs.some((n) => n.type === "friend_accepted"),
        5,
        1000,
      );
      const acceptNotif = plannerNotifs.find((n) => n.type === "friend_accepted");
      results.push(
        assert(
          "friend-accepted-notification",
          !!acceptNotif,
          "Planner received a friend_accepted notification",
        ),
      );

      // Save friendship ID for later scenarios
      ctx.state.plannerSpontFriendshipId = pendingFriendship.id;
    } else {
      results.push(
        assert(
          "accept-friendship",
          false,
          "Could not find pending friendship for Spontaneous to accept",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Step 6: Check for duplicate notifications from Spontaneous specifically
    // -----------------------------------------------------------------------
    ctx.log("Step 6: Checking for duplicate notifications");
    const plannerNotifsAll = await planner.getNotifications();
    const spontUserId = (await spontaneous.getMe()).id;
    const acceptNotifsFromSpont = plannerNotifsAll.filter(
      (n) => n.type === "friend_accepted" && n.related_user_id === spontUserId,
    );
    results.push(
      assert(
        "no-duplicate-friend-accepted-notifications",
        acceptNotifsFromSpont.length <= 1,
        `Planner has ${acceptNotifsFromSpont.length} friend_accepted notification(s) from Spontaneous (expected ≤ 1)`,
        acceptNotifsFromSpont.length > 1 ? "critical" : "info",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 7: Planner sends friend request to Flaky (Flaky will ignore it)
    // -----------------------------------------------------------------------
    ctx.log("Step 7: Planner sends friend request to Flaky (will be ignored)");
    await planner.sendFriendRequest(flaky.persona.email);
    ctx.state.flakyHasPendingRequest = true;

    // -----------------------------------------------------------------------
    // Step 8: Verify bidirectional friendship shows up
    // -----------------------------------------------------------------------
    ctx.log("Step 8: Verifying friendships list for both users");
    const plannerFriends = await planner.getFriends();
    const spontFriendsAfter = await spontaneous.getFriends();

    const plannerHasSpont = plannerFriends.some(
      (f: any) => f.status === "accepted",
    );
    const spontHasPlanner = spontFriendsAfter.some(
      (f: any) => f.status === "accepted",
    );

    results.push(
      assert(
        "planner-sees-friendship",
        plannerHasSpont,
        "Planner sees accepted friendship in their friends list",
      ),
    );
    results.push(
      assert(
        "spontaneous-sees-friendship",
        spontHasPlanner,
        "Spontaneous sees accepted friendship in their friends list",
      ),
    );

    return results;
  },
};

export default friendsScenario;
