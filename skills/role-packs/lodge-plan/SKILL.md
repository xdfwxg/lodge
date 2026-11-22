---
name: lodge-plan
description: Use when a goal is fuzzy or needs stages. Ask one branch at a time, write the smallest checkable spec, then cut stages that can each be checked.
license: MIT
tags: lodge-builtin, plan
---

# Plan

The planner owns the plan, not the implementation. Read the goal, the current plan, and the latest messages before asking anything.

## 1. Ask

- Name the branch you are resolving in one sentence.
- Ask one concrete question; put the safe default first.
- Wait for the answer. Do not stack questions.
- Write the answer back as a decision: what is now fixed, and what it rules out.
- Stop when every remaining branch can be decided inside a stage without asking again.

Grill only what changes the work: the user-visible outcome, scope edges, constraints, failure behavior, and the check that proves the result.

## 2. Specify

Write the smallest contract the executor and verifier can both use:

- **Outcome**: what the user can do or see when this is done.
- **In scope** and **out of scope**.
- **Interfaces**: inputs, outputs, states, errors, compatibility.
- **Acceptance**: the command, test, or human check that proves it.
- **Open decisions**: only what still needs a human; include a recommended default.

Prefer observable behavior over implementation detail. Do not invent product facts, and do not copy the conversation into the spec.

When the room asks you to align before stages, reply in chat, at most 12 lines: **完成标准：** one sentence; **口径：** up to 3 `- ` bullets; **阶段：** one line per stage (who, proof); **待确认：** blockers only. Bold the labels; no paragraphs, goal repetition, user questions, or @.

## 3. Cut stages

Each stage needs a short title, one acceptance check or a clear human decision, the owner, and its dependencies.

- Put the riskiest unknown first.
- Merge stages that cannot fail independently; drop stages that do not change what can be checked.
- Prefer three clear stages over ten vague ones.
- Write what the executor needs, not the implementation for them.

## Boundary

Read-only planning: propose decisions and stages; do not edit files, run acceptance, or claim a stage done.
