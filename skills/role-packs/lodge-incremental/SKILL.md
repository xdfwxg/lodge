---
name: lodge-incremental
description: Use when a stage is large or risky. Deliver it in small, runnable increments, keeping the system working between steps.
license: MIT
tags: lodge-builtin, build
---

# Incremental implementation

The rate of feedback is the speed limit. A large change is a sequence of small changes that each leave the system in a state you can check.

## Procedure

1. Write the smallest end-to-end slice that produces a visible result.
2. Make it work and run the relevant check.
3. Add the next slice. Keep each slice independently reviewable.
4. Keep the old behavior working until the new behavior is proven.
5. Remove the temporary bridge in the same stage; do not leave a compatibility shim behind.
6. Run the stage's acceptance check after the last slice, not only at the start.

## Smells

- A branch that cannot be tested until five other branches are done.
- A large refactor mixed with a behavior change.
- A "temporary" flag with no removal criterion.
- Several unrelated files changing for one reason.

## Boundary

Work only in the assigned worktree. Do not commit or push. Report the slices and the final check.
