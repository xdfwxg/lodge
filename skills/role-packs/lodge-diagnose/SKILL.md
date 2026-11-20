---
name: lodge-diagnose
description: Use when something is broken, failing, slow, or mysterious. Build a feedback loop that goes red on the problem before changing code.
license: MIT
tags: lodge-builtin, build
---

# Diagnose

Do not fix what you have not reproduced. A diagnosis is a loop, not a guess.

## Loop

1. **Reproduce**: find the smallest command, test, or browser action that shows the failure. Record the exact output.
2. **Minimise**: remove inputs, steps, and code until the failure is as small as you can make it without making it disappear.
3. **Hypothesise**: write one sentence that predicts what will change the result.
4. **Instrument**: add the smallest observation that distinguishes the hypothesis from the alternatives. Prefer a test or a log you can remove.
5. **Fix**: change one cause. Re-run the reproducer.
6. **Regress**: add a test that fails before the fix and passes after. Run the wider suite.

## Rules

- A passing unrelated test is not evidence.
- If the reproducer is flaky, make the flakiness visible before fixing the feature.
- Separate "the test is wrong" from "the code is wrong".
- Do not silence an error to make the loop green.

## Boundary

Work only in the assigned worktree. Do not commit or push. Report the failing command, the changed cause, and the passing command.
