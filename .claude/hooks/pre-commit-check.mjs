/**
 * Claude Code PreToolUse hook — intercepts `git commit` commands.
 *
 * Hard gates:  vitest + build must both pass or the commit is blocked.
 * Soft nudge:  if both pass, injects a docs-reminder system message.
 *
 * For non-commit Bash commands the script outputs `{}` (no-op).
 */

import { execSync } from "child_process";

const chunks = [];

process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const command = input.input?.command ?? "";

  // Only act on git commit commands
  if (!/\bgit\s+commit\b/.test(command)) {
    console.log(JSON.stringify({}));
    return;
  }

  // --- Hard gate 1: tests ---
  try {
    execSync("npx vitest run", { stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "Tests failed — fix failing tests before committing.\n" +
          (err.stderr?.toString().slice(-500) ?? ""),
      }),
    );
    return;
  }

  // --- Hard gate 2: build ---
  try {
    execSync("npm run build", { stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "Build failed — fix build errors before committing.\n" +
          (err.stderr?.toString().slice(-500) ?? ""),
      }),
    );
    return;
  }

  // --- Both passed — soft docs reminder ---
  console.log(
    JSON.stringify({
      systemMessage:
        "Pre-commit checks passed (tests + build). " +
        "Reminder: consider whether these changes require updates to " +
        "SPEC.md or design docs in docs/design/.",
    }),
  );
});
