---
name: lodge-ui
description: Use when a stage builds or verifies a user interface. Check the real rendered states, keyboard access, and a screenshot that actually shows the promised state.
license: MIT
tags: lodge-builtin, build, verify
---

# UI

A UI change is done when the rendered states are right, not when the code compiles.

## Build

- Follow the existing design system, components, and tokens; do not invent a second one.
- List the states the change can produce: empty, loading, success, error, disabled, long content.
- Keep the interaction obvious; remove decorative complexity that does not help the task.
- Leave the page in a state the verifier can open.

## Check

- Open the real app or the closest available render.
- Walk the golden path, then the edge states.
- Check narrow width, keyboard focus, contrast, and layout shift around the change.
- Inspect the DOM, styles, console, and failed requests for the changed area.
- Record the URL, viewport, and action; capture the smallest screenshot that proves the state.

## Accessibility

- Every action is reachable without a pointer; focus order follows reading order.
- Focus is visible and moves sensibly after dialogs and route changes.
- Use real buttons, links, labels, headings, lists, and landmarks.
- Every control has an accessible name; icons are not the only label.
- Validation errors are associated with the field and announced.
- Respect reduced motion; stay usable at 200% zoom.

## Evidence rules

- A screenshot is evidence only if it shows the state the stage promised.
- Do not rely on a cached page when the change is server-rendered.
- Do not click a destructive action to see what happens without approval.
- If the page cannot be reached, report the blocker; do not substitute a code reading for visual evidence.
- For speed claims, measure the same metric before and after.

## Boundary

The executor works in the assigned area; the verifier stays read-only. Do not submit forms or change external state without approval.
