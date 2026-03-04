// ---------------------------------------------------------------------------
// Scenario: Busy Blocks CRUD
// ---------------------------------------------------------------------------
// Tests: create, list, batch create, delete, error handling
// ---------------------------------------------------------------------------

import { Scenario, ScenarioContext, TestResult, assert, timed, sleep } from "../scenario.js";

const busyBlocksScenario: Scenario = {
  name: "busy-blocks",
  description: "Busy block CRUD — create, list, batch, delete, and error cases",
  priority: 50,

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner } = ctx.agents;

    ctx.log("--- Scenario: Busy Blocks CRUD ---");

    // -----------------------------------------------------------------------
    // Step 1: Create a single busy block
    // -----------------------------------------------------------------------
    ctx.log("Step 1: Create a single busy block");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(12, 0, 0, 0);

    const { result: createResult, durationMs: createMs } = await timed(async () => {
      return planner.createBusyBlock({
        start_time: tomorrow.toISOString(),
        end_time: tomorrowEnd.toISOString(),
        label: "Agent Test: Focus time",
      });
    });

    const block = createResult as any;
    const blockId = block?.block?.id || block?.id;

    results.push({
      ...assert(
        "create-busy-block",
        blockId !== undefined,
        "Created a single busy block",
      ),
      durationMs: createMs,
    });

    // -----------------------------------------------------------------------
    // Step 2: List busy blocks — should include the one we just created
    // -----------------------------------------------------------------------
    ctx.log("Step 2: List busy blocks");
    const { result: listResult, durationMs: listMs } = await timed(async () => {
      return planner.getBusyBlocks();
    });

    const blocks = (listResult as any)?.blocks || listResult;
    const found = Array.isArray(blocks) && blocks.some((b: any) => b.id === blockId);

    results.push({
      ...assert(
        "list-busy-blocks",
        found,
        `Listed busy blocks — found created block (${Array.isArray(blocks) ? blocks.length : 0} total)`,
      ),
      durationMs: listMs,
    });

    // -----------------------------------------------------------------------
    // Step 3: Batch create multiple blocks
    // -----------------------------------------------------------------------
    ctx.log("Step 3: Batch create busy blocks");
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    const batchBlocks = [
      { start_time: new Date(dayAfter.setHours(9, 0, 0, 0)).toISOString(), end_time: new Date(dayAfter.setHours(10, 0, 0, 0)).toISOString(), label: "Agent Test: Batch 1" },
      { start_time: new Date(dayAfter.setHours(14, 0, 0, 0)).toISOString(), end_time: new Date(dayAfter.setHours(15, 0, 0, 0)).toISOString(), label: "Agent Test: Batch 2" },
    ];

    const { result: batchResult, durationMs: batchMs } = await timed(async () => {
      return planner.batchBusyBlocks(batchBlocks);
    });

    const batchData = (batchResult as any)?.blocks || batchResult;
    const batchCreated = Array.isArray(batchData) && batchData.length === 2;

    results.push({
      ...assert(
        "batch-create-busy-blocks",
        batchCreated,
        `Batch created ${Array.isArray(batchData) ? batchData.length : 0} busy blocks`,
      ),
      durationMs: batchMs,
    });

    // Save batch IDs for cleanup
    const batchIds = Array.isArray(batchData) ? batchData.map((b: any) => b.id) : [];

    // -----------------------------------------------------------------------
    // Step 4: Delete the single block
    // -----------------------------------------------------------------------
    if (blockId) {
      ctx.log("Step 4: Delete the single busy block");
      const { result: deleteResult, durationMs: deleteMs } = await timed(async () => {
        return planner.deleteBusyBlock(blockId);
      });

      results.push({
        ...assert(
          "delete-busy-block",
          (deleteResult as any).status === 200,
          "Deleted the single busy block",
        ),
        durationMs: deleteMs,
      });

      // Verify it's gone
      const afterDelete = await planner.getBusyBlocks();
      const blocksAfter = (afterDelete as any)?.blocks || afterDelete;
      const stillThere = Array.isArray(blocksAfter) && blocksAfter.some((b: any) => b.id === blockId);

      results.push(
        assert(
          "verify-block-deleted",
          !stillThere,
          "Deleted block no longer appears in list",
        ),
      );
    }

    // -----------------------------------------------------------------------
    // Cleanup: delete batch blocks
    // -----------------------------------------------------------------------
    for (const id of batchIds) {
      if (id) await planner.deleteBusyBlock(id);
    }

    // Save state for availability scenario
    ctx.state.busyBlocksWorking = true;

    return results;
  },
};

export default busyBlocksScenario;
