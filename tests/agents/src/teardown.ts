// ---------------------------------------------------------------------------
// Teardown Script — clean up test agent data after a test run
// ---------------------------------------------------------------------------
// Run this to reset test state:
//   npm run teardown
// ---------------------------------------------------------------------------

import * as admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { SlottedClient } from "./client.js";
import { PERSONAS } from "./personas.js";

function loadEnv() {
  const envPath = resolve(import.meta.dirname || __dirname, "../.env");
  if (!existsSync(envPath)) {
    console.error("❌ Missing .env file.");
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

loadEnv();

const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./service-account.json";
const fullSaPath = resolve(import.meta.dirname || __dirname, "..", saPath);
if (existsSync(fullSaPath)) {
  const serviceAccount = JSON.parse(readFileSync(fullSaPath, "utf-8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function main() {
  console.log("🧹 Slotted Test Agent Teardown\n");

  // Use any agent to call admin endpoints
  const persona = Object.values(PERSONAS)[0];
  const client = new SlottedClient(persona);

  // Clean up notifications for all test agents via admin endpoints
  for (const [name, p] of Object.entries(PERSONAS)) {
    const uid = process.env[p.envUidKey];
    if (!uid) {
      console.log(`⚠️  Skipping ${name} — no UID in .env`);
      continue;
    }

    try {
      // Authenticate to get the Supabase user ID
      const agentClient = new SlottedClient(p);
      await agentClient.authenticate();
      const supabaseId = await agentClient.getSupabaseUserId();

      console.log(`Cleaning up ${name} (${supabaseId})...`);

      // Delete all notifications
      const deleteResult = await client.adminDeleteNotifications(supabaseId);
      console.log(`  ✓ Deleted notifications: ${JSON.stringify(deleteResult)}`);

      // Clear FCM tokens
      await client.adminClearFcmTokens(supabaseId);
      console.log("  ✓ Cleared FCM tokens");
    } catch (err: any) {
      console.error(`  ✗ Error cleaning ${name}: ${err.message}`);
    }
  }

  console.log("\n✅ Teardown complete!");
}

main().catch(console.error).finally(() => process.exit(0));
