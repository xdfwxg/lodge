---
name: lodge-frontend-ui
description: Use when a stage changes a user interface. Verify the real rendered states, including empty, loading, error, narrow, and dark where relevant.
license: MIT
tags: lodge-builtin, build
---

# Frontend UI

A UI change is not done when the code compiles. It is done when the rendered states are right.

## Procedure

1. Identify the states the change can produce: empty, loading, success, error, disabled, and long content.
2. Open the real app or the closest available render. Use the browser tools when the page is reachable.
3. Check the golden path first, then the edge states.
4. Check narrow widths, keyboard focus, and contrast for the changed area.
5. Confirm the change does not shift unrelated layout.
6. Capture a screenshot or the exact DOM/style evidence for the verifier.

## Rules

- Follow the existing design system; do not invent a second one.
- Reuse existing components and tokens before adding new ones.
- Keep the interaction obvious; remove decorative complexity that does not help the task.
- Do not claim visual correctness from code alone.

## Boundary

Work only in the assigned worktree. Do not commit or push. Leave the page in a state the verifier can open.
