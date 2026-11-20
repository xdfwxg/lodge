---
name: lodge-simplify
description: Use after a change works when the code has extra abstractions, duplicated decisions, or an interface wider than its callers need.
license: MIT
tags: lodge-builtin, build
---

# Simplify

Working code is the starting point, not the finish line. Remove what the stage does not need, without changing behavior.

## Procedure

1. Re-read the stage's acceptance. Anything not needed for it is a candidate for deletion.
2. Find duplicate decisions: the same rule encoded in two places.
3. Find single-use abstractions: a helper, layer, or option with one caller.
4. Narrow interfaces. If a caller must know an internal detail, the seam is in the wrong place.
5. Inline or delete the temporary bridge. Do not leave a compatibility shim.
6. Run the checks after each simplification.

## Test

- If deleting the code makes the callers simpler, delete it.
- If deleting it makes callers know more, keep it.
- If two names describe one thing, keep one.
- If a comment explains what the code plainly does, remove the comment.

## Boundary

Do not refactor unrelated code. Do not commit or push. Keep the diff tied to the assigned stage.
