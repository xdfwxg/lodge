---
name: lodge-build-2
description: Use when implementing or simplifying a stage. Restate the intent, build in checkable vertical slices, stop after two failed attempts, and hand back evidence instead of a story.
license: MIT
tags: lodge-builtin, build
---

# Build

A stage is done when a named result exists and its check passes.

## Intent first

- Restate the stage's outcome and acceptance in one line before starting.
- If the steps cannot produce it, say so and propose the smallest correction.
- If the request conflicts with the goal, the goal wins; report the conflict with your next-best option.

## Slice loop

1. Pick one vertical slice; name the behavior and the seam.
2. Write the smallest failing test at that seam; confirm it fails for the missing behavior, not a broken test.
3. Write the smallest implementation that passes; add no unrequested behavior.
4. Run the focused test, then the relevant suite.
5. Refactor with the tests green; keep the interface small.
6. Repeat.

## Stop conditions

- Two attempts on the same failure without new evidence: stop.
- Report what you tried, the smallest repro, the exact error, and what you need.
- Do not thrash or widen scope to hide it; if the only path changes the goal, hand it back.

## Keep it running

- Prefer the smallest end-to-end slice that produces a visible result.
- Keep the old behavior until the new one is proven; remove the temporary bridge in the same stage.
- Run the stage's acceptance after the last slice, not only at the start.
- Do not mix a large refactor with a behavior change.

## Simplify

- Anything not needed for the acceptance is a deletion candidate.
- Find the same decision in two places; delete single-use abstractions.
- If deleting makes callers simpler, delete; if it makes them know more, keep.
- If two names describe one thing, keep one.

Do not refactor unrelated code. Keep the diff tied to the stage.

## Test quality

- Test through a public interface, not private helpers.
- One reason to fail per test; a test that passes without the feature is not a test.
- No horizontal slicing: all tests first, then all code.

## Handoff

- Done or not done first, then the exact check and result, files changed, and the next smallest step.
- Do not narrate the journey; the evidence is the story.

## Boundary

Work in the assigned work area (worktree or room folder). Do not commit or push.
