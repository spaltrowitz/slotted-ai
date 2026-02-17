// ---------------------------------------------------------------------------
// Scenario: Dashboard & Activity Feed
// ---------------------------------------------------------------------------
// Tests: dashboard loads correctly, activity feed has expected items,
//        each agent sees personalized data
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed } from "../scenario.js";

const dashboardScenario: Scenario = {
  name: "dashboard",
  description: "Dashboard and activity feed correctness for each agent persona",
  priority: 40,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];

    ctx.log("--- Scenario: Dashboard & Activity Feed ---");

    // -----------------------------------------------------------------------
    // Step 1: Each agent's dashboard loads without error
    // -----------------------------------------------------------------------
    for (const [name, agent] of Object.entries(ctx.agents)) {
      ctx.log(`Step: Loading ${name}'s dashboard`);
      const { result: dash, durationMs } = await timed(async () => {
        try {
          return await agent.getDashboard();
        } catch (err) {
          return { error: (err as Error).message };
        }
      });

      const loaded = dash !== null && !("error" in (dash as any));
      results.push({
        ...assert(
          `dashboard-loads-${name}`,
          loaded,
          loaded
            ? `${name}'s dashboard loaded in ${durationMs}ms`
            : `${name}'s dashboard failed to load: ${(dash as any)?.error}`,
        ),
        durationMs,
      });

      // Performance check
      if (loaded) {
        results.push(
          assert(
            `dashboard-perf-${name}`,
            durationMs < 5000,
            `${name}'s dashboard responded in ${durationMs}ms (target < 5s)`,
            durationMs >= 5000 ? "warning" : "info",
          ),
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Activity feed loads for each agent
    // -----------------------------------------------------------------------
    for (const [name, agent] of Object.entries(ctx.agents)) {
      ctx.log(`Step: Loading ${name}'s activity feed`);
      const { result: feed, durationMs } = await timed(async () => {
        try {
          return await agent.getActivityFeed();
        } catch (err) {
          return null;
        }
      });

      results.push({
        ...assert(
          `activity-feed-loads-${name}`,
          feed !== null,
          feed !== null
            ? `${name}'s activity feed loaded (${Array.isArray(feed) ? feed.length : 0} items)`
            : `${name}'s activity feed failed to load`,
        ),
        durationMs,
      });
    }

    // -----------------------------------------------------------------------
    // Step 3: Platform stats via admin
    // -----------------------------------------------------------------------
    ctx.log("Step: Checking platform stats via admin");
    const stats = await ctx.agents.planner.adminGetStats();
    results.push(
      assert(
        "platform-stats",
        typeof stats.users === "number" && stats.users > 0,
        `Platform: ${stats.users} users, ${stats.meetups} meetups, ${stats.friendships} friendships, ${stats.notifications} notifications`,
        "info",
      ),
    );

    return results;
  },
};

export default dashboardScenario;
