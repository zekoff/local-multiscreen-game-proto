#!/usr/bin/env node
// SessionStart hook: inject GAME_DESIGN_DIRECTION.md into the model's context at
// the start of every session. That file holds the game's design pillars and
// desired UX and is the authoritative guide for all implementation decisions.
// It is maintained solely by the user — the agent must never edit it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// CLAUDE_PROJECT_DIR is set by Claude Code for hooks; fall back to cwd.
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

try {
  const doc = readFileSync(join(root, "GAME_DESIGN_DIRECTION.md"), "utf8");
  // Prefix reminds the agent what this document is and the rules around it.
  const prefix =
    "# GAME_DESIGN_DIRECTION.md — the game's design pillars & desired player " +
    "experience. This is the authoritative guide for ALL implementation " +
    "decisions. It is maintained solely by the user; NEVER edit it yourself. " +
    "If decisions made while iterating affect the design direction, prompt the " +
    "user to update this document manually and summarize those decisions for " +
    "them.\n\n";
  // SessionStart hooks inject text via hookSpecificOutput.additionalContext.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: prefix + doc,
      },
    }),
  );
} catch {
  // If the file is missing, emit nothing rather than failing the session start.
  process.stdout.write("{}");
}
