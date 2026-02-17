// ---------------------------------------------------------------------------
// Test Agent Runner — orchestrates scenarios and produces a report
// ---------------------------------------------------------------------------
// Usage:
//   npm test                        — run all scenarios
//   npm run scenario:friends        — run only the friends scenario
//   npm run scenario:notifications  — run only the notifications scenario
//   npm run scenario:all            — run all scenarios
// ---------------------------------------------------------------------------

import * as admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { SlottedClient } from "./client.js";
import { PERSONAS } from "./personas.js";
import { Scenario, ScenarioContext, TestResult } from "./scenario.js";

// Import scenarios
import friendsScenario from "./scenarios/friends.js";
import meetupsScenario from "./scenarios/meetups.js";
import notificationsScenario from "./scenarios/notifications.js";
import dashboardScenario from "./scenarios/dashboard.js";

// ---------------------------------------------------------------------------
// All available scenarios
// ---------------------------------------------------------------------------
const ALL_SCENARIOS: Scenario[] = [
  friendsScenario,
  meetupsScenario,
  notificationsScenario,
  dashboardScenario,
].sort((a, b) => a.priority - b.priority);

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = resolve(import.meta.dirname || __dirname, "../.env");
  if (!existsSync(envPath)) {
    console.error("❌ Missing .env file. Copy .env.example to .env and fill in values.");
    process.exit(1);
  }
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------
function printReport(allResults: { scenario: string; results: TestResult[] }[]) {
  console.log("\n" + "=".repeat(70));
  console.log("  SLOTTED TEST AGENT REPORT");
  console.log("  " + new Date().toISOString());
  console.log("=".repeat(70) + "\n");

  let totalPassed = 0;
  let totalFailed = 0;
  let totalWarnings = 0;

  for (const { scenario, results } of allResults) {
    console.log(`\n📋 ${scenario}`);
    console.log("-".repeat(50));

    for (const r of results) {
      const icon = r.passed ? "✅" : r.severity === "warning" ? "⚠️ " : "❌";
      const time = r.durationMs > 0 ? ` (${r.durationMs}ms)` : "";
      console.log(`  ${icon} ${r.message}${time}`);

      if (r.passed) {
        totalPassed++;
      } else if (r.severity === "warning") {
        totalWarnings++;
      } else {
        totalFailed++;
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `  SUMMARY: ${totalPassed} passed, ${totalFailed} failed, ${totalWarnings} warnings`,
  );
  console.log("=".repeat(70) + "\n");

  if (totalFailed > 0) {
    console.log("❌ CRITICAL FAILURES:");
    for (const { scenario, results } of allResults) {
      for (const r of results) {
        if (!r.passed && r.severity === "critical") {
          console.log(`  • [${scenario}] ${r.name}: ${r.message}`);
        }
      }
    }
    console.log();
  }

  return { totalPassed, totalFailed, totalWarnings };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  loadEnv();

  // Parse CLI args
  const args = process.argv.slice(2);
  const scenarioFlag = args.find((a) => a.startsWith("--scenario="))?.split("=")[1]
    || (args.indexOf("--scenario") >= 0 ? args[args.indexOf("--scenario") + 1] : null);

  // Initialize Firebase Admin
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./service-account.json";
  const fullSaPath = resolve(import.meta.dirname || __dirname, "..", saPath);
  if (!existsSync(fullSaPath)) {
    console.error(`❌ Service account key not found at ${fullSaPath}`);
    console.error("Download from Firebase Console → Project Settings → Service Accounts");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(readFileSync(fullSaPath, "utf-8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  console.log("🤖 Slotted Test Agent Runner\n");

  // -------------------------------------------------------------------------
  // Authenticate all agents
  // -------------------------------------------------------------------------
  console.log("Authenticating agents...");
  const agents: Record<string, SlottedClient> = {};

  for (const [name, persona] of Object.entries(PERSONAS)) {
    const uid = process.env[persona.envUidKey];
    if (!uid) {
      console.error(`  ❌ ${name}: Missing ${persona.envUidKey} in .env — run npm run setup first`);
      process.exit(1);
    }

    const client = new SlottedClient(persona);
    try {
      await client.authenticate();
      // Ensure profile exists
      await client.getMe();
      console.log(`  ✅ ${name} (${persona.displayName}) authenticated`);
      agents[name] = client;
    } catch (err: any) {
      console.error(`  ❌ ${name}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log();

  // -------------------------------------------------------------------------
  // Select and run scenarios
  // -------------------------------------------------------------------------
  let scenarios: Scenario[];
  if (scenarioFlag && scenarioFlag !== "all") {
    const found = ALL_SCENARIOS.find((s) => s.name === scenarioFlag);
    if (!found) {
      console.error(`❌ Unknown scenario: ${scenarioFlag}`);
      console.error(`Available: ${ALL_SCENARIOS.map((s) => s.name).join(", ")}, all`);
      process.exit(1);
    }
    scenarios = [found];
  } else {
    scenarios = ALL_SCENARIOS;
  }

  console.log(`Running ${scenarios.length} scenario(s): ${scenarios.map((s) => s.name).join(", ")}\n`);

  const allResults: { scenario: string; results: TestResult[] }[] = [];
  const ctx: ScenarioContext = {
    agents,
    state: {},
    log: (msg: string) => console.log(`  💬 ${msg}`),
  };

  for (const scenario of scenarios) {
    console.log(`\n🚀 Starting: ${scenario.name} — ${scenario.description}`);
    const startTime = Date.now();

    try {
      const results = await scenario.run(ctx);
      const elapsed = Date.now() - startTime;
      console.log(`  ⏱️  Completed in ${elapsed}ms`);
      allResults.push({ scenario: scenario.name, results });
    } catch (err: any) {
      console.error(`  💥 Scenario crashed: ${err.message}`);
      allResults.push({
        scenario: scenario.name,
        results: [
          {
            name: "scenario-crash",
            passed: false,
            severity: "critical",
            message: `Scenario crashed: ${err.message}`,
            durationMs: Date.now() - startTime,
          },
        ],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Print report
  // -------------------------------------------------------------------------
  const { totalFailed } = printReport(allResults);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
