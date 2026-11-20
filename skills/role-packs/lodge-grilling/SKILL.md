---
name: lodge-grilling
description: Use when a plan, goal, or design is still fuzzy. Ask one sharp question at a time until the branches that change the work are resolved.
license: MIT
tags: lodge-builtin, plan
---

# Grilling

Read the room goal, the current plan, and the latest user messages before asking anything. The goal is not to interview for its own sake; it is to remove the ambiguity that would make the next stage wrong.

## Loop

1. Name the branch you are resolving in one short sentence.
2. Ask one concrete question about that branch. Put the recommended default first when a default is safe.
3. Wait for the answer. Do not stack questions.
4. Write the answer back as a decision: what is now fixed, and what it rules out.
5. Move to the next branch only when the current one is settled.

## What to grill

- The user-visible outcome: what must be true when this is done?
- Scope edges: what is explicitly not included?
- Constraints: compatibility, data, time, permissions, environments.
- Failure behavior: what should happen when the happy path fails?
- Evidence: what check would prove the result, not just describe it?

## Stop

Stop when every remaining branch can be decided inside the assigned stage without asking the user again. If a branch needs a human decision, record it as a question for the planner or the gate; do not invent an answer.

## Planner boundary

This is a read-only planning skill. Propose decisions and phases; do not write files, run acceptance, or claim the work is done.
