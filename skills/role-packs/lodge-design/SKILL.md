---
name: lodge-design
description: Use when a change crosses module, term, or API boundaries. Name the terms, choose the seam, and write the smallest contract before code.
license: MIT
tags: lodge-builtin, plan, build
---

# Design

A shared word is a compressed decision; an interface is a promise. Make both small enough to check.

## Terms

- Collect the words that decide behavior: entities, states, events, roles, boundaries.
- Define each in one sentence a new teammate can use.
- Split or rename overloaded words; test each one at an edge case.
- Use the same words in stages, deliverables, code, and messages.

## Boundaries

- **Module**: a unit with one reason to change.
- **Interface**: what callers must know.
- **Seam**: where a dependency can be replaced without editing the module.
- **Depth**: behavior per unit of interface a caller must learn.
- **Locality**: related decisions sit next to each other.

Dependencies point inward: application logic does not import concrete adapters. Apply the deletion test: if deleting the module makes callers simpler, it is not earning its keep.

## Contract

For the boundary being changed, write down:

- **Caller**: who uses it, and what they actually need.
- **Inputs**: shape, null/empty behavior, limits, validation.
- **Outputs**: success shape, errors, partial results.
- **Failure**: timeout, retry, duplicate call, cancellation.
- **Compatibility**: what existing callers keep; what must migrate.
- **Evidence**: the test or command that proves the contract.

## Rules

- Prefer one clear contract over a framework for hypothetical flexibility.
- Do not leak implementation details into the interface.
- Keep failure behavior as explicit as success behavior.
- Planner proposes; executor implements behind the seam and tests through the public interface.

## Boundary

Planning is read-only. Do not write files or judge the result; describe the contract and the seam.
