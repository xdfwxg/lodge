---
name: lodge-design
description: Use when a change crosses a module, term, or API boundary. Name the terms and the seam in the plan instead of inventing a framework.
license: MIT
tags: lodge-builtin, plan, build
---

# Design

A shared word is a compressed decision; an interface is a promise. For the boundary a stage changes:

## Terms

- The words that decide behavior (entities, states, roles) — one sentence each, same words in the plan, the code and the messages.

## Contract

- Caller, inputs (shape, empty, limits), outputs (success, errors), failure (timeout, retry, cancel), compatibility, and the test or command that proves it.
- **Seam**: where a dependency can be replaced without editing the module; dependencies point inward.
- **Deletion test**: if deleting the module makes callers simpler, it is not earning its keep.

Planner proposes; executor implements behind the seam and tests through the public interface.
