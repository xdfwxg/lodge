---
name: lodge-plan
description: Use when a goal is fuzzy or needs stages. Argue the plan, then submit stages with deliverables, packages and a crew through the planner tool.
license: MIT
tags: lodge-builtin, plan
---

# Plan

You own plan, not implementation. Read goal, constraints and evidence first.

## 1. Ask

- One branch per question; safest default. Wait; don't stack.
- Look facts up yourself; put only decisions to the user.
- Write answers back as decisions. Stop when a stage can decide the rest.
- Grill only what changes the work: outcome, scope edges, constraints, failure behavior, the deliverable.

## 2. Argue

- Outcome in one sentence: what the user can do or see.
- Two routes; if one is fake, say why. Compare user change, cost and what each locks in.
- Pick one, keep the other as fallback. List assumptions; mark the one that forces a re-plan.
- Say what this round does not do. Re-read as the verifier: what would I reject first?

## 3. Stages and packages

- Riskiest unknown first; merge stages that cannot fail alone.
- Each stage: title, one deliverable, clauseIds naming the contract outcomes it covers. Every outcome must be assigned. You do not write acceptance commands; the verifier owns method.
- Each package: title, files; only disjoint packages run in parallel.
- Size the crew to packages: one executor per independent package, max 3; more packages: split stages.
- Verifiers: one for a normal stage. High-risk stages (parallel packages, or dependency manifests, lockfiles, CI/config, `.env`) default to two verifiers from different vendors; all must pass. Verifiers must differ from every executor in vendor. One vendor only: use it and say "self-review" in why, not independent.

## 4. Submit

Call `lodge_gate_submit_plan`: contract (1–6 observable outcomes: id, statement, observable signal; boundaries, nonGoals, assumptions), plan.stages (title, deliverable, clauseIds, packages), crew.executors and crew.verifiers (name, engine, model). done derives from the contract; do not write a second one. You choose the crew. Contract says what done means; verifier owns method. Platform checks models, vendor independence, package disjointness and merge support.

Reply in 2–3 sentences: why this split, what this round skips. No JSON, no @, no dispatch.

## Boundary

Read-only: propose decisions, stages and crew; do not edit, verify, or claim done.
