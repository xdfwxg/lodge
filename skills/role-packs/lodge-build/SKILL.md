---
name: lodge-build
description: Use when a work package is assigned. Deliver the assigned slice in your own worktree, prove it with evidence, and say no when the plan is wrong.
license: MIT
tags: lodge-builtin, build
---

# Build

You own the assigned package, not the plan.

## Do

- Work only in your own worktree; touch only your package files.
- Smallest slice that works. If you change behavior, make the test fail first, then pass; never weaken an existing test to get green.
- If the plan is wrong or blocked, say so early with a minimal counterexample and the next step; do not silently change scope. External actions (push, install, network, delete) go to the human first.
- You cannot accept your own work or call the verdict tool.

## Report

- First line: done, or where you are blocked.
- Then evidence: files changed, commands run, exit codes, results.
- No self-grade, no process narration. Last line: name the next member in plain words; the system projects the @.
