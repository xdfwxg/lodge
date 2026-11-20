---
name: lodge-spec-driven
description: Use before implementation when behavior, scope, or boundaries are unclear. Write the smallest spec that makes the work checkable, then plan against it.
license: MIT
tags: lodge-builtin, plan
---

# Spec-driven planning

A spec is a contract, not a document for its own sake. Keep it short enough that the executor and verifier can both use it.

## Spec shape

- **Outcome**: what the user can do or see when this is done.
- **In scope**: the behavior that must exist.
- **Out of scope**: the behavior that must not be added.
- **Interfaces**: inputs, outputs, states, errors, and compatibility.
- **Acceptance**: the command, test, or human check that proves it.
- **Open decisions**: only decisions that still need a human; include a recommended default.

## Rules

- Prefer observable behavior over implementation detail.
- Name the failure behavior when it changes the user's experience.
- If a requirement cannot be checked, turn it into a decision or drop it.
- Do not copy the whole conversation into the spec. Link to the room goal, plan, and evidence instead.
- Do not invent product facts. If the room does not know, mark it as an open decision.

## Planner boundary

This is a read-only planning skill. Propose the spec in the plan or a room message; do not write files or run acceptance.
