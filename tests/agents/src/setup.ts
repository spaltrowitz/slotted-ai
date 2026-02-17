// ---------------------------------------------------------------------------
// Setup Script — creates/ensures test agent accounts exist in Slotted
// ---------------------------------------------------------------------------
// Run this once before running scenarios:
//   npm run setup
// ---------------------------------------------------------------------------

import * as admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { SlottedClient } from "./client.js";
import { PERSONAS } from "./personas.js";

// Load .env
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

loadEnv();

// Initialize Firebase Admin
const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./service-account.json";
const fullSaPath = resolve(import.meta.dirname || __dirname, "..", saPath);
if (!existsSync(fullSaPath)) {
  console.error(`❌ Service account key not found at ${fullSaPath}`);
  console.error("Download from Firebase Console → Project Settings → Service Accounts → Generate New Private Key");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(fullSaPath, "utf-8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function main() {
  console.log("🔧 Slotted Test Agent Setup\n");

  for (const [name, persona] of Object.entries(PERSONAS)) {
    console.log(`--- Setting up ${name} (${persona.email}) ---`);

    const uid = process.env[persona.envUidKey];
    if (!uid) {
      console.log(`  ⚠️  ${persona.envUidKey} not set in .env`);
      console.log(`  → Create account ${persona.email} in Firebase Auth, then add the UID to .env`);

      // Try to find or create the user in Firebase
      try {
        const existingUser = await admin.auth().getUserByEmail(persona.email);
        console.log(`  ✓ Found existing Firebase user: ${existingUser.uid}`);
        console.log(`  → Add to .env: ${persona.envUidKey}=${existingUser.uid}`);
      } catch {
        console.log(`  → User doesn't exist in Firebase yet. Creating...`);
        try {
          const newUser = await admin.auth().createUser({
            email: persona.email,
            displayName: persona.displayName,
            emailVerified: true,
          });
          console.log(`  ✓ Created Firebase user: ${newUser.uid}`);
          console.log(`  → Add to .env: ${persona.envUidKey}=${newUser.uid}`);
        } catch (err: any) {
          console.log(`  ✗ Failed to create user: ${err.message}`);
        }
      }
      continue;
    }

    console.log(`  Firebase UID: ${uid}`);

    // Authenticate and set up the user profile
    try {
      const client = new SlottedClient(persona);
      await client.authenticate();
      console.log("  ✓ Authenticated successfully");

      // Upsert the user profile
      const user = await client.upsertMe({
        display_name: persona.displayName,
        timezone: persona.timezone,
      });
      console.log(`  ✓ Profile synced (Supabase ID: ${user.id})`);

      // Complete onboarding if not done
      if (!user.onboarded) {
        await client.completeOnboarding();
        console.log("  ✓ Onboarding completed");
      } else {
        console.log("  ✓ Already onboarded");
      }

      // Set social battery
      await client.updateBattery(persona.socialBattery);
      console.log(`  ✓ Social battery set to: ${persona.socialBattery}`);
    } catch (err: any) {
      console.error(`  ✗ Error: ${err.message}`);
    }

    console.log();
  }

  console.log("✅ Setup complete! Run: npm test");
}

main().catch(console.error).finally(() => process.exit(0));
