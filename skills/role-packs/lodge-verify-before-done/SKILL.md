---
name: lodge-verify-before-done
description: Use before saying a stage is done. Run the promised check, inspect the result, and report the exact evidence instead of a claim.
license: MIT
tags: lodge-builtin, verify
---

# Verify before done

Done means observed, not intended.

## Checklist

1. Restate the stage's acceptance check.
2. Run it yourself in the assigned worktree or read-only copy.
3. Confirm the result is about the requested behavior, not an unrelated green.
4. For UI work, inspect the rendered page, not only the build.
5. For a bug fix, confirm the reproducer fails before and passes after.
6. Report the exact command, exit code, and the smallest relevant output.
7. If a check cannot run, say what is missing and do not call the stage done.

## Red flags

- "Should work."
- "Tests pass" without naming the tests.
- A screenshot that does not show the changed state.
- A green suite that never exercised the change.
- A manual check described but not performed.

## Boundary

The executor may run checks and report evidence. The verifier may run checks and write a verdict, but not change the work. Neither replaces a failed check with an explanation.
