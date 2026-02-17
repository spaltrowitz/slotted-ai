// ---------------------------------------------------------------------------
// Scenario: Notification Integrity
// ---------------------------------------------------------------------------
// Tests: duplicate detection, notification counts, read/unread state,
//        bulk operations, and cleanup
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep } from "../scenario.js";

const notificationsScenario: Scenario = {
  name: "notifications",
  description: "Notification deduplication, read/unread state, bulk operations",
  priority: 30,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous } = ctx.agents;

    ctx.log("--- Scenario: Notification Integrity ---");

    // -----------------------------------------------------------------------
    // Step 1: Get baseline notification counts
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Baseline notification counts");
    const plannerCount = await planner.getUnreadCount();
    const spontCount = await spontaneous.getUnreadCount();

    results.push(
      assert(
        "planner-unread-count-valid",
        typeof plannerCount === "number" && plannerCount >= 0,
        `Planner has ${plannerCount} unread notifications`,
        "info",
      ),
    );
    results.push(
      assert(
        "spontaneous-unread-count-valid",
        typeof spontCount === "number" && spontCount >= 0,
        `Spontaneous has ${spontCount} unread notifications`,
        "info",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 2: Verify no notification appears more than expected
    // -----------------------------------------------------------------------
    ctx.log("Step 2: Checking for duplicate notifications across all agents");
    for (const [name, agent] of Object.entries(ctx.agents)) {
      const notifs = await agent.getNotifications();

      // Group by (type + related_id) and check for duplicates
      const groups = new Map<string, number>();
      for (const n of notifs) {
        const key = `${n.type}:${n.related_id || "none"}`;
        groups.set(key, (groups.get(key) || 0) + 1);
      }

      const dupes = [...groups.entries()].filter(([, count]) => count > 1);
      results.push(
        assert(
          `no-duplicate-notifs-${name}`,
          dupes.length === 0,
          dupes.length === 0
            ? `${name} has no duplicate notifications`
            : `${name} has ${dupes.length} duplicate notification group(s): ${dupes.map(([k, c]) => `${k} (×${c})`).join(", ")}`,
          dupes.length > 0 ? "critical" : "info",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Mark all read, then verify count is 0
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Testing mark-all-read");
    await planner.markAllNotificationsRead();
    await sleep(500);

    const afterMarkRead = await planner.getUnreadCount();
    results.push(
      assert(
        "mark-all-read-works",
        afterMarkRead === 0,
        `After mark-all-read, Planner has ${afterMarkRead} unread (expected 0)`,
      ),
    );

    // -----------------------------------------------------------------------
    // Step 4: Individual notification read
    // -----------------------------------------------------------------------
    ctx.log("Step 4: Testing individual notification read");
    const spontNotifs = await spontaneous.getNotifications();
    const unreadNotif = spontNotifs.find((n) => !n.read);

    if (unreadNotif) {
      await spontaneous.markNotificationRead(unreadNotif.id);
      await sleep(500);

      const spontNotifsAfter = await spontaneous.getNotifications();
      const readNotif = spontNotifsAfter.find((n) => n.id === unreadNotif.id);
      results.push(
        assert(
          "individual-mark-read",
          readNotif?.read === true,
          "Individual notification marked as read successfully",
        ),
      );
    } else {
      results.push(
        assert("individual-mark-read", true, "No unread notifications to test (skipped)", "info"),
      );
    }

    // -----------------------------------------------------------------------
    // Step 5: Admin — verify notification counts match
    // -----------------------------------------------------------------------
    ctx.log("Step 5: Admin verification — notification counts match");
    const spontId = await spontaneous.getSupabaseUserId();
    const adminNotifs = await planner.adminGetNotifications(spontId);
    const userNotifs = await spontaneous.getNotifications();

    // Admin sees all; user sees filtered (no cancelled/declined). Admin count >= user count.
    results.push(
      assert(
        "admin-user-notification-consistency",
        adminNotifs.length >= userNotifs.length,
        `Admin sees ${adminNotifs.length} notifications, user sees ${userNotifs.length} (admin ≥ user due to filtering)`,
        adminNotifs.length < userNotifs.length ? "critical" : "info",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 6: Verify notification structure
    // -----------------------------------------------------------------------
    ctx.log("Step 6: Verifying notification structure");
    if (adminNotifs.length > 0) {
      const sample = adminNotifs[0];
      const hasRequiredFields =
        "id" in sample &&
        "user_id" in sample &&
        "type" in sample &&
        "title" in sample &&
        "body" in sample &&
        "read" in sample &&
        "created_at" in sample;

      results.push(
        assert(
          "notification-structure",
          hasRequiredFields,
          "Notifications have all required fields (id, user_id, type, title, body, read, created_at)",
        ),
      );
    }

    return results;
  },
};

export default notificationsScenario;
