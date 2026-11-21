---
name: lodge-build
description: Use when implementing or simplifying a stage. Build in checkable vertical slices, keep the system running, and remove what the stage does not need.
license: MIT
tags: lodge-builtin, build
---

# Build

A stage is done when a named result exists and its check passes.

## Slice loop

1. Pick one vertical slice; name the behavior and the seam.
2. Write the smallest failing test at that seam. Confirm it fails because the behavior is missing, not because the test is broken.
3. Write the smallest implementation that passes. Do not add unrequested behavior.
4. Run the focused test, then the relevant suite.
5. Refactor with the tests green; keep the interface small.
6. Repeat for the next slice.

## Keep it running

- Prefer the smallest end-to-end slice that produces a visible result.
- Keep the old behavior working until the new behavior is proven.
- Remove the temporary bridge in the same stage; do not leave a compatibility shim.
- Run the stage's acceptance after the last slice, not only at the start.
- Do not mix a large refactor with a behavior change.

## Simplify

- Re-read the acceptance; anything not needed for it is a deletion candidate.
- Find the same decision encoded in two places.
- Delete single-use abstractions; narrow interfaces whose callers must know internals.
- If deleting code makes callers simpler, delete it; if it makes callers know more, keep it.
- If two names describe one thing, keep one.

Do not refactor unrelated code. Keep the diff tied to the stage.

## Test quality

- Test behavior through a public interface, not private helpers.
- One reason to fail per test; a test that passes whether or not the feature exists is not a test.
- No horizontal slicing: all tests first, then all code.

## Boundary

Work in the assigned work area (worktree or room folder). Do not commit or push. Report the exact check and its result.
