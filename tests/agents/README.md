# Slotted Test Agents

Automated QA agents that simulate 3 real users interacting with each other on Slotted. They test friend requests, meetup scheduling, notifications, and more — catching bugs like the duplicate notification issue Tamer reported.

## Architecture

```
tests/agents/
├── src/
│   ├── client.ts          # Typed SDK wrapping the Slotted REST API
│   ├── personas.ts        # 3 agent personas (Planner, Spontaneous, Flaky)
│   ├── scenario.ts        # Scenario framework (assertions, timing)
│   ├── runner.ts          # Orchestrator — authenticates agents, runs scenarios, prints report
│   ├── setup.ts           # One-time account setup
│   ├── teardown.ts        # Clean up test data
│   └── scenarios/
│       ├── friends.ts     # Friend request lifecycle
│       ├── meetups.ts     # Meetup proposal, RSVP, counter-propose
│       ├── notifications.ts # Duplicate detection, read/unread state
│       └── dashboard.ts   # Dashboard & activity feed correctness
```

## Quick Start

### 1. Prerequisites

- 3 Google test accounts (e.g. `slotted.tester1@gmail.com`, `slotted.tester2@gmail.com`, `slotted.tester3@gmail.com`)
- A Firebase service account key (JSON)

### 2. Setup

```bash
cd tests/agents

# Copy env template and fill in values
cp .env.example .env

# Download service account key from:
# Firebase Console → Project Settings → Service Accounts → Generate New Private Key
# Save as service-account.json in this directory

# Install deps
npm install

# Create/find Firebase users and set up profiles
npm run setup
```

The setup script will:
- Find or create Firebase Auth users for each test account
- Print their Firebase UIDs (add them to `.env`)
- Create Slotted user profiles with appropriate persona settings

### 3. Fill in `.env`

After running setup, add the Firebase UIDs and your Firebase Web API Key:

```env
API_BASE_URL=https://slottedapp.com/api
ADMIN_SECRET=your-admin-secret
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
FIREBASE_API_KEY=your-web-api-key

AGENT1_EMAIL=slotted.tester1@gmail.com
AGENT1_FIREBASE_UID=abc123...

AGENT2_EMAIL=slotted.tester2@gmail.com
AGENT2_FIREBASE_UID=def456...

AGENT3_EMAIL=slotted.tester3@gmail.com
AGENT3_FIREBASE_UID=ghi789...
```

Find your Web API Key in Firebase Console → Project Settings → General.

### 4. Run Tests

```bash
# Run all scenarios
npm test

# Run a specific scenario
npm run scenario:friends
npm run scenario:meetups
npm run scenario:notifications

# Clean up test data afterward
npm run teardown
```

## Scenarios

| Scenario | What it tests |
|----------|---------------|
| **friends** | Send request → notification → accept → verify bidirectional friendship → check for duplicate notifications |
| **meetups** | Create meetup → invite notification → accept/decline → counter-propose → verify notification filtering after decline |
| **notifications** | Duplicate detection, read/unread state, mark-all-read, admin vs user notification consistency |
| **dashboard** | Dashboard loads correctly for each persona, activity feed, performance checks, platform stats |

## Agent Personas

| Agent | Style | Tests |
|-------|-------|-------|
| **Tessa Planner** | Books ahead, full calendar | Planner flows, structured scheduling |
| **Sam Spontaneous** | Last-minute, sparse calendar | Spontaneous flows, quick RSVP |
| **Fiona Flaky** | Rarely opens app, recharging | Ignored invites, stale notifications, reminders |

## Adding New Scenarios

Create a new file in `src/scenarios/`:

```typescript
import { Scenario, ScenarioContext, TestResult, assert } from "../scenario.js";

const myScenario: Scenario = {
  name: "my-scenario",
  description: "What it tests",
  priority: 50,  // lower = runs first

  async run(ctx: ScenarioContext): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const { planner, spontaneous, flaky } = ctx.agents;

    // Your test steps here...
    results.push(assert("test-name", true, "It works!"));

    return results;
  },
};

export default myScenario;
```

Then import it in `src/runner.ts` and add to `ALL_SCENARIOS`.

## Sample Output

```
🤖 Slotted Test Agent Runner

Authenticating agents...
  ✅ planner (Tessa Planner) authenticated
  ✅ spontaneous (Sam Spontaneous) authenticated
  ✅ flaky (Fiona Flaky) authenticated

Running 4 scenario(s): friends, meetups, notifications, dashboard

🚀 Starting: friends — Friend request lifecycle
  💬 Step 1: Planner sends friend request to Spontaneous
  💬 Step 2: Checking Spontaneous's notifications for friend request
  ...
  ⏱️  Completed in 8234ms

======================================================================
  SLOTTED TEST AGENT REPORT
======================================================================

📋 friends
--------------------------------------------------
  ✅ ✓ Planner can send friend request to Spontaneous (342ms)
  ✅ ✓ Spontaneous received a friend_request notification (189ms)
  ✅ ✓ Planner has 1 friend_accepted notification(s) (expected ≤ 1)
  ...

======================================================================
  SUMMARY: 22 passed, 0 failed, 1 warnings
======================================================================
```
