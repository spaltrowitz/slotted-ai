// ---------------------------------------------------------------------------
// Scenario: Groups CRUD
// ---------------------------------------------------------------------------
// Tests: create, list, update, add members, delete, auth errors
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep } from "../scenario.js";

const groupsScenario: Scenario = {
  name: "groups",
  description: "Group lifecycle — create, update, add members, delete, and authorization checks",
  priority: 55,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    ctx.log("--- Scenario: Groups CRUD ---");

    const plannerId = await planner.getSupabaseUserId();
    const spontId = await spontaneous.getSupabaseUserId();
    const flakyId = await flaky.getSupabaseUserId();

    // -----------------------------------------------------------------------
    // Step 1: Planner creates a group with Spontaneous
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Planner creates a group");
    const { result: createResult, durationMs: createMs } = await timed(async () => {
      return planner.createGroup("Agent Test: Brunch Crew", [spontId], "🥐");
    });

    const group = createResult as any;
    const groupId = group?.id;

    results.push({
      ...assert(
        "create-group",
        !!groupId,
        "Planner created a group",
      ),
      durationMs: createMs,
    });

    if (!groupId) return results;

    // -----------------------------------------------------------------------
    // Step 2: List groups — Planner should see it
    // -----------------------------------------------------------------------
    ctx.log("Step 2: List groups for Planner");
    const { result: plannerGroups, durationMs: listMs } = await timed(async () => {
      return planner.getGroups();
    });

    const foundGroup = Array.isArray(plannerGroups) &&
      plannerGroups.some((g: any) => g.id === groupId);

    results.push({
      ...assert(
        "list-groups-planner",
        foundGroup,
        `Planner sees the group in their list (${Array.isArray(plannerGroups) ? plannerGroups.length : 0} groups)`,
      ),
      durationMs: listMs,
    });

    // -----------------------------------------------------------------------
    // Step 3: Spontaneous should also see the group
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Spontaneous lists groups");
    const spontGroups = await spontaneous.getGroups();
    const spontSeesGroup = Array.isArray(spontGroups) &&
      spontGroups.some((g: any) => g.id === groupId);

    results.push(
      assert(
        "list-groups-spontaneous",
        spontSeesGroup,
        "Spontaneous sees the group they were added to",
      ),
    );

    // -----------------------------------------------------------------------
    // Step 4: Update group name and emoji
    // -----------------------------------------------------------------------
    ctx.log("Step 4: Planner updates group name & emoji");
    const { result: updateResult, durationMs: updateMs } = await timed(async () => {
      return planner.updateGroup(groupId, { name: "Agent Test: Dinner Crew", emoji: "🍽️" });
    });

    results.push({
      ...assert(
        "update-group",
        updateResult !== null,
        "Planner updated group name and emoji",
      ),
      durationMs: updateMs,
    });

    // -----------------------------------------------------------------------
    // Step 5: Add Flaky as a new member
    // -----------------------------------------------------------------------
    ctx.log("Step 5: Add Flaky to the group");

    // First ensure Planner and Flaky are friends (from friends scenario)
    const { result: addResult, durationMs: addMs } = await timed(async () => {
      return planner.addGroupMembers(groupId, [flakyId]);
    });

    const addData = addResult as any;
    results.push({
      ...assert(
        "add-group-member",
        addData !== null,
        "Added Flaky to the group",
        "warning",
      ),
      durationMs: addMs,
    });

    // -----------------------------------------------------------------------
    // Step 6: Unauthorized delete — Spontaneous tries to delete Planner's group
    // -----------------------------------------------------------------------
    ctx.log("Step 6: Spontaneous tries to delete (should fail)");
    const { result: unauthorizedDelete, durationMs: unauthMs } = await timed(async () => {
      return spontaneous.deleteGroup(groupId);
    });

    const unauthStatus = (unauthorizedDelete as any).status;
    results.push({
      ...assert(
        "unauthorized-group-delete",
        unauthStatus === 404 || unauthStatus === 403,
        `Non-creator delete returned ${unauthStatus} (expected 403 or 404)`,
      ),
      durationMs: unauthMs,
    });

    // -----------------------------------------------------------------------
    // Step 7: Planner deletes the group (cleanup)
    // -----------------------------------------------------------------------
    ctx.log("Step 7: Planner deletes the group");
    const { result: deleteResult, durationMs: deleteMs } = await timed(async () => {
      return planner.deleteGroup(groupId);
    });

    results.push({
      ...assert(
        "delete-group",
        (deleteResult as any).status === 200,
        "Planner successfully deleted the group",
      ),
      durationMs: deleteMs,
    });

    // Verify it's gone
    const afterDelete = await planner.getGroups();
    const stillThere = Array.isArray(afterDelete) &&
      afterDelete.some((g: any) => g.id === groupId);

    results.push(
      assert(
        "verify-group-deleted",
        !stillThere,
        "Deleted group no longer appears in list",
      ),
    );

    return results;
  },
};

export default groupsScenario;
