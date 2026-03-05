// ---------------------------------------------------------------------------
// Setup Script — creates/ensures test agent accounts exist in Slotted
// ---------------------------------------------------------------------------
// Run this once before running scenarios:
//   npm run setup
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, writeFileSync } from "fs";
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
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
if (!FIREBASE_API_KEY) {
  console.error("❌ Missing FIREBASE_API_KEY in .env");
  console.error("Find it at Firebase Console → Project Settings → General → Web API Key");
  process.exit(1);
}

async function createOrSignIn(email: string, password: string, displayName: string): Promise<{ uid: string; idToken: string }> {
  // Try to sign in first
  const signInResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  if (signInResp.ok) {
    const data = (await signInResp.json()) as { idToken: string; localId: string };
    return { uid: data.localId, idToken: data.idToken };
  }

  // Sign-in failed — create the account
  console.log(`  → Creating new account...`);
  const signUpResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );

  if (!signUpResp.ok) {
    const body = await signUpResp.text();
    throw new Error(`Failed to create account for ${email}: ${signUpResp.status} ${body}`);
  }

  const data = (await signUpResp.json()) as { idToken: string; localId: string };
  return { uid: data.localId, idToken: data.idToken };
}

async function main() {
  console.log("🔧 Slotted Test Agent Setup\n");

  const envPath = resolve(import.meta.dirname || __dirname, "../.env");
  let envContent = readFileSync(envPath, "utf-8");

  for (const [name, persona] of Object.entries(PERSONAS)) {
    console.log(`--- Setting up ${name} (${persona.email}) ---`);

    try {
      const { uid } = await createOrSignIn(persona.email, persona.password, persona.displayName);
      console.log(`  ✓ Firebase UID: ${uid}`);

      // Update .env with the UID if not already set
      if (!process.env[persona.envUidKey]) {
        envContent += `\n${persona.envUidKey}=${uid}`;
        process.env[persona.envUidKey] = uid;
        console.log(`  ✓ Added ${persona.envUidKey}=${uid} to .env`);
      }

      // Authenticate and set up the user profile
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

  // Write updated .env
  writeFileSync(envPath, envContent);
  console.log("✅ Setup complete! Run: npm test");
}

main().catch(console.error).finally(() => process.exit(0));
