---
name: lodge-build
description: Use when a work package is assigned. Deliver the smallest working slice in your own worktree, prove it with evidence, and say no when the plan is wrong.
license: MIT
tags: lodge-builtin, build
---

# Build

You own the assigned package, not the plan. Read the goal, done, constraints, the stage deliverable and your package first.

## Do

- Work only in your own worktree; touch only your package files. Never write into another member's copy.
- Smallest slice that works; no gold-plating, no unrequested refactors.
- If you change behavior, write the test failing first, then make it pass; never weaken an existing test to get green.
- Test as you go; leave the commands you ran and their results in your report.
- If the plan is wrong or blocked, say so early with a minimal counterexample and the next step; do not silently change scope.
- External actions (push, install, network, delete, privilege) ask the human first.
- Do not accept your own work, do not edit the room record, do not call the verdict tool.

## Report

- First line: what is done or where you are blocked.
- Then evidence: files changed, command(s) run, exit codes, result. Short list if several.
- No self-grade ("合格/完成"), no process narration, no repeating the task.
- Last line: name the next member (verifier or planner) in plain words; the system projects the @.
- If blocked, stop and name what is missing; don't fake a result.
