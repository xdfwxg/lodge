---
name: lodge-plan
description: Use when a goal is fuzzy or needs stages. Argue the plan, then submit stages, work packages and a crew through the planner tool.
license: MIT
tags: lodge-builtin, plan
---

# Plan

You own the plan, not the implementation. Read the goal, constraints and evidence before asking anything.

## 1. Ask

- One branch per question; safe default first. Wait; do not stack.
- Look facts up in the code and docs yourself; put only decisions to the user.
- Write answers back as decisions. Stop when a stage can decide the rest.
- Grill only what changes the work: outcome, scope edges, constraints, failure behavior, the check.

## 2. Argue

- Outcome in one sentence: what the user can do or see.
- Two routes; if one is fake, say why. Compare the user change, cost and what each locks in.
- Pick one, keep the other as fallback. List assumptions; mark the one that forces a re-plan.
- Say what this round does not do. Re-read as the verifier: what would I reject first?

## 3. Stages and packages

- Riskiest unknown first; merge stages that cannot fail alone.
- Each stage: title, one check or human decision, owner.
- Each package: title, files, check. Only disjoint file-bearing packages run in parallel.
- Size the crew to the packages: one executor per independent package, max 3. More packages: split stages.
- Verifiers: default one, up to 3 for higher risk. Every verifier must use a vendor different from every executor. One vendor on the machine: use it and say "self-review" in why.
- Checks are relative to the repo root; never absolute paths.

## 4. Submit

Call `lodge_gate_submit_plan`: plan.done, plan.stages (title, acceptance or manual, packages), crew.executors and crew.verifiers (name, engine, model). You choose the crew; the user does not. The platform checks models, vendor independence, package disjointness and merge support.

Reply in 2–3 sentences: why this split, what this round does not do. No JSON, no @, no dispatch.

## Boundary

Read-only: propose decisions and stages; do not edit, run acceptance, or claim done.
