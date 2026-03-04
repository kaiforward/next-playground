/**
 * Global setup for integration tests.
 *
 * Runs once before all integration test files:
 * 1. Sets DATABASE_URL to the test database if not already set
 * 2. Validates it points to a `_test` database (safety guard)
 * 3. Pushes the Prisma schema to the test database
 */
import { execSync } from "child_process";

const DEFAULT_TEST_URL = "postgresql://postgres:postgres@localhost:5432/stellar_trader_test";

export default function globalSetup() {
  // globalSetup runs before Vitest's `env` config is applied, so set the default here
  const url = process.env["DATABASE_URL"] || DEFAULT_TEST_URL;
  process.env["DATABASE_URL"] = url;

  if (!url.includes("_test")) {
    throw new Error(
      `DATABASE_URL does not point to a test database (must contain '_test' in the name).\n` +
      `Current value: ${url}\n` +
      `This safety guard prevents accidentally running integration tests against your dev database.`,
    );
  }

  console.log("[integration setup] Pushing schema to test database...");
  execSync(`npx prisma db push --url "${url}" --accept-data-loss`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  console.log("[integration setup] Schema push complete.");
}
