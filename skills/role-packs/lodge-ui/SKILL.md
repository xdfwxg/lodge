---
name: lodge-ui
description: Use when a stage builds or verifies a user interface. Check the real rendered states and capture the smallest screenshot that proves the promised state.
license: MIT
tags: lodge-builtin, build, verify
---

# UI

A UI change is done when the rendered states are right, not when the code compiles.

## Build

- Follow the existing design system, components and tokens; do not invent a second one.
- List the states the change can produce (empty, loading, success, error, disabled, long content) and leave the page in one the verifier can open.

## Check

- Open the real app or the closest render; walk the golden path, then the edge states.
- Check narrow width, keyboard focus and contrast for the changed area; inspect DOM, console and failed requests.
- Actions reachable without a pointer; focus visible; real buttons, links and labels; every control has an accessible name; errors are announced.
- A screenshot is evidence only if it shows the state the stage promised. If the page cannot be reached, report the blocker instead of substituting a code reading.
- Measure the same metric before and after for speed claims.

Executor works in the assigned area; verifier stays read-only. Do not submit forms or change external state without approval.
