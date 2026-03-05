// ---------------------------------------------------------------------------
// Scenario Framework — defines the shape of a test scenario
// ---------------------------------------------------------------------------

import { SlottedClient } from "./client.js";

export type Severity = "critical" | "warning" | "info";

export interface TestResult {
  name: string;
  passed: boolean;
  severity: Severity;
  message: string;
  details?: unknown;
  durationMs: number;
}

export interface ScenarioContext {
  /** Agent clients keyed by persona name */
  agents: Record<string, SlottedClient>;
  /** Shared state that scenarios can write to and later scenarios can read */
  state: Record<string, unknown>;
  /** Log a message to the test output */
  log: (msg: string) => void;
}

export interface Scenario {
  name: string;
  description: string;
  /** Scenarios run in order of priority (lower = first) */
  priority: number;
  /** The actual test steps */
  run: (ctx: ScenarioContext) => Promise<TestResult[]>;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------
export function assert(
  name: string,
  condition: boolean,
  message: string,
  severity: Severity = "critical",
): TestResult {
  return {
    name,
    passed: condition,
    severity,
    message: condition ? `✓ ${message}` : `✗ ${message}`,
    durationMs: 0,
  };
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a function until its result satisfies the predicate, with retries.
 */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (result: T) => boolean,
  maxAttempts = 5,
  delayMs = 1000,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await fn();
    if (predicate(result)) return result;
    await sleep(delayMs);
  }
  return fn();
}
