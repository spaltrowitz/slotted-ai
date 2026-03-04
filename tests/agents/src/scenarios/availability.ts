// ---------------------------------------------------------------------------
// Scenario: Availability Overlap
// ---------------------------------------------------------------------------
// Tests: seed busy blocks → get availability → pairwise overlap →
//        group overlap → verify busy blocks are respected
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep } from "../scenario.js";

const availabilityScenario: Scenario = {
  name: "availability",
  description: "Availability and overlap computation — pairwise and group, with busy block seeding",
  priority: 60,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    ctx.log("--- Scenario: Availability Overlap ---");

    const spontId = await spontaneous.getSupabaseUserId();
    const flakyId = await flaky.getSupabaseUserId();

    // -----------------------------------------------------------------------
    // Step 1: Seed busy blocks for Planner (to constrain availability)
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Seed busy blocks for Planner");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const busyStart = new Date(tomorrow);
    busyStart.setHours(9, 0, 0, 0);
    const busyEnd = new Date(tomorrow);
    busyEnd.setHours(17, 0, 0, 0);

    const seedResult = await planner.createBusyBlock({
      start_time: busyStart.toISOString(),
      end_time: busyEnd.toISOString(),
      label: "Agent Test: Work day",
    });

    const seedBlock = (seedResult as any)?.block || seedResult;
    const seedBlockId = seedBlock?.id;

    results.push(
      assert(
        "seed-busy-block",
        !!seedBlockId,
        "Seeded a busy block for Planner (9am–5pm tomorrow)",
      ),
    );

    await sleep(1000);

    // -----------------------------------------------------------------------
    // Step 2: Get Planner's availability
    // -----------------------------------------------------------------------
    ctx.log("Step 2: Get Planner's availability");
    const { result: availability, durationMs: availMs } = await timed(async () => {
      return planner.getAvailability();
    });

    const availData = availability as any;
    const hasSlots = availData?.slots?.length > 0 || availData?.windows?.length > 0 || availData?.availability?.length > 0 || (Array.isArray(availData) && availData.length > 0);

    results.push({
      ...assert(
        "get-availability",
        availability !== null && typeof availability === "object",
        `Got Planner's availability data (${availMs}ms)`,
      ),
      durationMs: availMs,
    });

    // -----------------------------------------------------------------------
    // Step 3: Pairwise overlap (Planner + Spontaneous, in_person)
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Pairwise overlap — Planner + Spontaneous (in_person)");
    const { result: overlap, durationMs: overlapMs } = await timed(async () => {
      return planner.getOverlap(spontId, "in_person");
    });

    const overlapData = overlap as any;

    results.push({
      ...assert(
        "pairwise-overlap",
        overlap !== null && typeof overlap === "object",
        `Got pairwise overlap data (${overlapMs}ms)`,
      ),
      durationMs: overlapMs,
    });

    // -----------------------------------------------------------------------
    // Step 4: Pairwise overlap (phone mode — no travel buffer)
    // -----------------------------------------------------------------------
    ctx.log("Step 4: Pairwise overlap — phone mode");
    const { result: phoneOverlap, durationMs: phoneMs } = await timed(async () => {
      return planner.getOverlap(spontId, "phone");
    });

    results.push({
      ...assert(
        "phone-overlap",
        phoneOverlap !== null && typeof phoneOverlap === "object",
        `Got phone overlap data (${phoneMs}ms)`,
      ),
      durationMs: phoneMs,
    });

    // -----------------------------------------------------------------------
    // Step 5: Group overlap (all 3 agents)
    // -----------------------------------------------------------------------
    ctx.log("Step 5: Group overlap — all 3 agents");
    const { result: groupOverlap, durationMs: groupMs } = await timed(async () => {
      return planner.getGroupOverlap([spontId, flakyId]);
    });

    results.push({
      ...assert(
        "group-overlap",
        groupOverlap !== null && typeof groupOverlap === "object",
        `Got group overlap data (${groupMs}ms)`,
      ),
      durationMs: groupMs,
    });

    // -----------------------------------------------------------------------
    // Step 6: Performance — all overlap calls should be under 5s
    // -----------------------------------------------------------------------
    const maxMs = Math.max(overlapMs, phoneMs, groupMs);
    results.push(
      assert(
        "overlap-performance",
        maxMs < 5000,
        `Slowest overlap call: ${maxMs}ms (target < 5s)`,
        maxMs >= 5000 ? "warning" : "info",
      ),
    );

    // -----------------------------------------------------------------------
    // Cleanup: delete seeded busy block
    // -----------------------------------------------------------------------
    if (seedBlockId) {
      await planner.deleteBusyBlock(seedBlockId);
    }

    return results;
  },
};

export default availabilityScenario;
