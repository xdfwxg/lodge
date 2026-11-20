---
name: lodge-codebase-design
description: Use when a change touches module boundaries. Design deep modules with small interfaces, explicit seams, and dependencies that point inward.
license: MIT
tags: lodge-builtin, plan
---

# Codebase design

A deep module hides a lot of behavior behind a small interface. The goal is not more layers; it is fewer reasons to know the same thing in two places.

## Vocabulary

- **Module**: a unit with one reason to change.
- **Interface**: what callers must know.
- **Seam**: the place where a dependency can be replaced without editing the module.
- **Adapter**: a concrete implementation at a seam.
- **Depth**: behavior per unit of interface a caller must learn.
- **Locality**: keeping related decisions next to each other.

## Procedure

1. Name the module that should own the decision.
2. List what callers actually need. Remove everything else from the interface.
3. Put the dependency behind a seam if it is external, slow, or likely to change.
4. Check the dependency direction: application logic must not import concrete adapters.
5. Apply the deletion test: if deleting the module makes callers simpler, the module is not earning its keep.
6. Prefer one clear boundary over a framework for hypothetical flexibility.

## Review questions

- Can a new engineer find the behavior from the interface?
- Can the module be tested through its interface without reaching inside?
- Does a small change require editing several layers?
- Is an abstraction hiding one implementation, or many?

## Planner boundary

This is a read-only planning skill. Propose boundaries and seams; do not edit code.
