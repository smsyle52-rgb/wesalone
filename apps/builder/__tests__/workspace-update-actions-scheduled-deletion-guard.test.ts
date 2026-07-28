// @vitest-environment node

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

// Normalized to LF: the assertions below match multi-line snippets literally,
// and a Windows checkout (core.autocrlf) hands back \r\n, so every one of them
// failed locally while passing on CI.
const actionSource = readFileSync(
  join(
    process.cwd(),
    "src/features/workspaces/actions/update-workspace-action.ts",
  ),
  "utf8",
).replace(/\r\n/g, "\n")

describe("workspace update actions scheduled-deletion guard", () => {
  test("allows only general settings updates during the deletion grace window", () => {
    expect(actionSource).toContain(
      "updateWorkspaceBasicAction =\n  workspaceActionClientAllowScheduledDeletion",
    )
    expect(actionSource).toContain(
      "updateWorkspaceAdvancedAction =\n  workspaceActionClientAllowScheduledDeletion",
    )
    expect(actionSource).toContain(
      "updateSmartResponseDelayAction = workspaceActionClient",
    )
  })
})
