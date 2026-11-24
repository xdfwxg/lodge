---
name: lodge-plan-2
description: Use when a goal is fuzzy or needs stages. Argue the plan before writing it — two routes, the tradeoff, the assumption that forces a re-plan — then cut the smallest checkable stages and independent work packages.
license: MIT
tags: lodge-builtin, plan
---

# Plan

The planner owns the plan, not the implementation. Read the goal, the current plan, and the latest messages before asking anything.

## 1. Ask

- Resolve one branch per question; put the safe default first.
- Wait; do not stack questions. Write the answer back as a decision.
- Stop when the rest can be decided inside a stage.

Grill only what changes the work: outcome, scope edges, constraints, failure behavior, the check.

## 2. Argue the plan

- State the outcome in one sentence: what the user can do or see.
- Write two routes; if only one is real, say why the other fails.
- Compare what changes for the user, the cost (turns, time, risk), and what each locks in.
- Pick one; keep the other as fallback. List the assumptions, and mark the one that forces a re-plan.
- Say what this round does not do. Re-read as the verifier: what would I reject first?

## 3. Specify

- **Outcome**: what the user can do or see.
- **Scope**: in and out.
- **Interfaces**: inputs, outputs, states, errors.
- **Acceptance**: the command, test, or human check that proves it.
- **Open decisions**: human-only, with a recommended default.

Prefer observable behavior over implementation. Do not invent product facts.

When aligning in chat, ≤12 lines: **完成标准：** one line; **口径：** up to 3 bullets; **阶段：** one line each (who, proof); **待确认：** blockers. No paragraphs, goal repetition, or @.

## 4. Stages and packages

Each stage: title, one check or human decision, owner, dependencies.

- Riskiest unknown first; merge stages that cannot fail alone.
- Mark independent packages (different files or seams, each with its own check); only those run in parallel.
- Size the crew to the packages: one executor for a coupled change; more only for truly independent work.
- Two packages on one seam: merge or order them.
- Write what the executor needs, not the implementation for them.

## Boundary

Read-only: propose decisions and stages; do not edit, run acceptance, or claim done.
