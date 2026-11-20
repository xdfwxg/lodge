---
name: lodge-domain-modeling
description: Use when naming, scope, or shared language is drifting. Sharpen the room's terms and record the decisions that make the work easier to discuss.
license: MIT
tags: lodge-builtin, plan
---

# Domain modeling

A shared word is a compression of a decision. When two people use the same word for different things, the plan will hide a disagreement.

## Procedure

1. Collect the terms that decide behavior: entities, states, events, roles, and boundaries.
2. For each term, write one sentence a new teammate could use.
3. Find the overloaded terms. Split them or rename them.
4. Stress-test each term with an edge case: what happens at the boundary?
5. Record decisions that are hard to reverse. A short decision note is enough; do not create a documentation project.
6. Use the same words in stages, acceptance, code names, and messages.

## Checks

- Can the term be explained without pointing at a file?
- Does the term describe the user's world or only the implementation?
- Does the same word appear with two meanings in the room?
- Is a vague word ("sync", "handle", "process") hiding a state machine?

## Output

Prefer a small glossary in the room's plan or a decision message. If the room has a glossary file, update it only when the role allows writing; otherwise propose the exact lines for the owner to apply.

## Planner boundary

This is a read-only planning skill. Propose terms and decisions; do not write files or change the code.
