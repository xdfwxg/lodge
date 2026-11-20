---
name: lodge-accessibility
description: Use when a change affects interactive UI. Check keyboard access, semantics, focus, contrast, labels, and error announcements.
license: MIT
tags: lodge-builtin, verify
---

# Accessibility

Accessibility is part of the interface contract, not a later polish pass.

## Checks

- **Keyboard**: every action reachable without a pointer; focus order matches reading order.
- **Focus**: visible focus; focus moves sensibly after dialogs and route changes.
- **Semantics**: real buttons, links, labels, headings, lists, and landmarks.
- **Names**: every control has an accessible name; icons are not the only label.
- **Contrast**: text and essential UI meet contrast requirements in light and dark.
- **Errors**: validation messages are associated with the field and announced.
- **Motion**: reduced-motion preferences are respected.
- **Zoom**: content remains usable at 200% without loss.

## Procedure

1. Identify the interactive elements the change adds or changes.
2. Test the keyboard path first.
3. Inspect the accessibility tree for names and roles.
4. Check contrast and focus styles in the rendered page.
5. Report concrete findings with the element and the failure.

## Boundary

Read-only review. Do not change the work; return fixes to the executor.
