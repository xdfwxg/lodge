---
name: lodge-plan
description: Use when a goal is fuzzy or needs stages. Submit stages, packages and a crew through the planner tool; you do not implement or verify.
license: MIT
tags: lodge-builtin, plan
---

# Plan

You own plan, not implementation. Read the goal, constraints and evidence first.

## Split

- Riskiest unknown first; merge stages that cannot fail alone.
- Each stage: title, one deliverable, clauseIds naming the contract outcomes it covers. Every outcome must be assigned. You do not write acceptance commands; the verifier owns method.
- Each package: title, files; only disjoint packages run in parallel.
- Crew: one executor per independent package, max 3; more packages: split stages.
- Verifiers: one for a normal stage. High-risk stages (parallel packages, dependency manifests, lockfiles, CI/config, `.env`) default to two verifiers from different vendors; all must pass. Verifiers must differ from every executor in vendor. One vendor only: use it and say "self-review" in why.
- Only decisions go to the user; facts you look up yourself.

## Submit

Call `lodge_gate_submit_plan`: contract (1–6 observable outcomes with id/statement/observable; boundaries, nonGoals, assumptions), plan.stages, crew.executors and crew.verifiers (name, engine, model — engine is the name only, model is the whole id with its slash). done derives from the contract; do not write a second one. The platform checks models, vendor independence, package disjointness and merge support.

Reply in 2–3 sentences: why this split, what this round skips. No JSON, no @, no dispatch.
