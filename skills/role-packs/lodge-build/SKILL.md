---
name: lodge-build
description: Use when a work package is assigned. Deliver the smallest working slice in your own worktree, prove it with evidence, and say no when the plan is wrong.
license: MIT
tags: lodge-builtin, build
---

# Build

You own the assigned package, not the plan. Read the goal, done, constraints, acceptance and your package first.

## Do

- Work only in your own worktree; touch only your package files. Never write into another member's copy.
- Smallest slice that works; no gold-plating, no unrequested refactors.
- If the check is a test, write it failing first, then make it pass; never weaken an existing test to get green.
- Test as you go; run the acceptance check and capture the command, exit code and result.
- If the plan is wrong or blocked, say so early with a minimal counterexample and the next step; do not silently change scope.
- External actions (push, install, network, delete, privilege) ask the human first.
- Do not accept your own work, do not edit the room record, do not call the verdict tool.

## Report

- First line: what is done or where you are blocked.
- Then evidence: files changed, command(s) run, exit codes, result. Short list if several.
- No self-grade ("合格/完成"), no process narration, no repeating the task.
- Last line: `@verifier` or `@planner` in plain words; no @ in the body and no fixed phrase.
- If blocked, stop and name what is missing; don't fake a result.
