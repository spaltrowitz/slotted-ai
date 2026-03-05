// ---------------------------------------------------------------------------
// Agent Personas — define the personality and behavior of each test agent
// ---------------------------------------------------------------------------

export interface AgentPersona {
  name: string;
  email: string;
  password: string;
  envUidKey: string;               // env var name holding the Firebase UID
  displayName: string;
  timezone: string;
  socialBattery: "open" | "ask_me" | "recharging";
  socialFrequency: string;
  planningStyle: string;
  preferredTimes: string[];
  travelBufferMin: number;
  neighborhood: string;
  description: string;             // human-readable description for logs
}

export const PERSONAS: Record<string, AgentPersona> = {
  planner: {
    name: "planner",
    email: process.env.AGENT1_EMAIL || "slotted.tester1@gmail.com",
    password: process.env.AGENT1_PASSWORD || "SlottedTest1!2026",
    envUidKey: "AGENT1_FIREBASE_UID",
    displayName: "Tessa Planner",
    timezone: "America/New_York",
    socialBattery: "open",
    socialFrequency: "2-3-week",
    planningStyle: "planner",
    preferredTimes: ["weekday-evening", "weekend-afternoon"],
    travelBufferMin: 30,
    neighborhood: "West Village, NYC",
    description: "Books things 1-2 weeks out. Full calendar. Prefers structure.",
  },

  spontaneous: {
    name: "spontaneous",
    email: process.env.AGENT2_EMAIL || "slotted.tester2@gmail.com",
    password: process.env.AGENT2_PASSWORD || "SlottedTest2!2026",
    envUidKey: "AGENT2_FIREBASE_UID",
    displayName: "Sam Spontaneous",
    timezone: "America/New_York",
    socialBattery: "open",
    socialFrequency: "daily",
    planningStyle: "spontaneous",
    preferredTimes: ["weekday-evening", "weekend-evening", "weekend-morning"],
    travelBufferMin: 15,
    neighborhood: "Williamsburg, Brooklyn",
    description: "Last-minute plans. Sparse calendar. Always down.",
  },

  flaky: {
    name: "flaky",
    email: process.env.AGENT3_EMAIL || "slotted.tester3@gmail.com",
    password: process.env.AGENT3_PASSWORD || "SlottedTest3!2026",
    envUidKey: "AGENT3_FIREBASE_UID",
    displayName: "Fiona Flaky",
    timezone: "America/New_York",
    socialBattery: "recharging",
    socialFrequency: "rarely",
    planningStyle: "flexible",
    preferredTimes: ["weekend-afternoon"],
    travelBufferMin: 45,
    neighborhood: "Park Slope, Brooklyn",
    description: "Rarely opens app. Ignores invites. Tests reminder & stale notification paths.",
  },
};
