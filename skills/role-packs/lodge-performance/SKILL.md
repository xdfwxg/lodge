---
name: lodge-performance
description: Use when a change affects speed, memory, rendering, or request volume. Measure first, set a budget, then verify the same measurement after the change.
license: MIT
tags: lodge-builtin, verify
---

# Performance

A performance claim needs a number and a method. Optimize the measured bottleneck, not the most interesting code.

## Procedure

1. Define the user-visible metric: load time, interaction latency, memory, request count, or frame cost.
2. Measure the baseline with a repeatable method. Record the environment and sample count.
3. Find the dominant cost from evidence: profile, trace, network waterfall, or query plan.
4. Set a budget or a target relative to the baseline.
5. Change one cause. Re-measure with the same method.
6. Check for regressions in adjacent paths, not just the improved one.

## Rules

- Do not optimize without a baseline.
- Do not trade correctness or accessibility for a micro-benchmark.
- Distinguish cold start, warm path, and worst-case input.
- Report the before/after numbers, not only "faster".

## Boundary

Read-only review unless the stage explicitly assigns a fix to the executor. Do not change the work in a verifier role.
