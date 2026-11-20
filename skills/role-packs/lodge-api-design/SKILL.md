---
name: lodge-api-design
description: Use when a change crosses a module or API boundary. Define the smallest contract first, then implement and test through that seam.
license: MIT
tags: lodge-builtin, plan, build
---

# API and interface design

An interface is a promise. Make the promise small, explicit, and testable before writing the implementation.

## Contract

For the boundary being changed, write down:

- **Caller**: who uses it, and what they actually need.
- **Inputs**: shape, null/empty behavior, limits, and validation.
- **Outputs**: success shape, errors, and partial results.
- **Failure**: timeout, retry, duplicate call, and cancellation.
- **Compatibility**: what existing callers can keep; what must migrate.
- **Evidence**: the test or command that proves the contract.

## Planner

Propose the interface and the seam. Do not write code. Ask whether the interface can be smaller and whether the module can be deleted; if deleting it makes callers simpler, the boundary is not earning its keep.

## Executor

Implement behind the agreed seam. Test through the public interface, not private helpers. Update callers in the same stage. Do not add a second compatibility path unless the stage explicitly requires it.

## Rules

- Prefer one clear contract over a framework for hypothetical flexibility.
- Do not leak implementation details into the interface.
- Keep failure behavior as explicit as success behavior.
- Do not change an API and its migration in one unverified step.
