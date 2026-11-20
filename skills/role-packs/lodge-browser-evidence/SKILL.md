---
name: lodge-browser-evidence
description: Use when a stage promises a browser-visible result. Open the real page, inspect the relevant state, and capture evidence the verifier can check.
license: MIT
tags: lodge-builtin, verify
---

# Browser evidence

A screenshot is not automatically evidence. It is evidence when it shows the state the stage promised.

## Procedure

1. Restate the visible acceptance: what should the user see or be able to do?
2. Open the page in the browser tools. Use a fresh session when the result depends on a clean state.
3. Walk the golden path. Then check the empty, loading, error, and narrow states that the change can affect.
4. Inspect the DOM, styles, console, and failed network requests for the changed area.
5. Capture the smallest screenshot or output that proves the state.
6. Record the URL, viewport, and action that produced the evidence.

## Rules

- Do not rely on a cached page when the change is server-rendered.
- Do not click through a destructive action to "see what happens" without approval.
- If the page cannot be reached, report the blocker; do not substitute a code reading for visual evidence.
- For accessibility or performance, use the dedicated checks rather than eyeballing.

## Boundary

Read-only. Do not edit the page, submit forms, or change external state without approval.
