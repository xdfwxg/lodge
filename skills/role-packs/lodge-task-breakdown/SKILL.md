---
name: lodge-task-breakdown
description: Use when turning a goal into stages. Split the work into the smallest stages that each produce a checkable result, with explicit dependencies and owners.
license: MIT
tags: lodge-builtin, plan
---

# Task breakdown

A stage is not a activity. It is a promise: after this stage, a named result exists and can be checked.

## Procedure

1. Restate the finish line in one sentence.
2. List the results that must exist for the finish line to be true.
3. Group results into stages. Each stage must have:
   - a short title;
   - one runnable acceptance command, or a clear human decision;
   - the owner role (planner, executor, verifier) or a named assignee;
   - the stages it depends on.
4. Put the riskiest unknown earliest. Do not hide it behind setup work.
5. Remove any stage that does not change what can be checked. Merge stages that cannot fail independently.
6. Keep the plan small. Prefer three clear stages over ten vague ones.

## Good stage

- "Export button writes a CSV that opens with three columns" with a command or human check.
- "Decision: choose between local and remote storage" with the options and the deciding criterion.

## Bad stage

- "Work on export."
- "Improve quality."
- "Research and implement everything."

## Handoff

For each stage, write what the executor needs: the result, the acceptance check, the files or area, and the constraints. Do not write the implementation for the executor; leave room for the work.

## Planner boundary

This is a read-only planning skill. Do not write files, run acceptance, or mark a stage complete.
