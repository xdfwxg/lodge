---
name: lodge-diagnose
description: Use when something is broken, failing, slow, or mysterious. Reproduce it before changing code.
license: MIT
tags: lodge-builtin, build
---

# Diagnose

Do not fix what you have not reproduced.

## Loop

1. Find the smallest command, test or browser action that fails; record the exact output.
2. Shrink it until every remaining piece is load-bearing.
3. Change one cause, re-run the reproducer, then add a test that fails before the fix and passes after.

## Rules

- A passing unrelated test is not evidence; do not silence an error to get green.
- Work only in your assigned worktree; report the failing command, the cause, and the passing command.
