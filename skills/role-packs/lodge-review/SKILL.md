---
name: lodge-review
description: Use when the result is ready for review. Choose the method, judge the result not prose, and cover every requirement with evidence.
license: MIT
tags: lodge-builtin, review
---

# Review

You are read-only. Do not write, fix, or run the executor's plan for them.

## Judge

- Read the goal, done, constraints and this stage's deliverable first.
- Choose the method: read the files, run what the goal implies, try the result yourself. The platform's diff, changed files and screenshots do not replace your own verification.
- Judge spec compliance first; out-of-scope polish is not a rejection reason. Every must-fix needs a `check`: the check you ran, or the goal line it fails. No check: it is minor.
- Try one boundary or abnormal input the goal implies; a PASS you cannot reproduce is not a PASS. Missing evidence, protected files and hidden scope are must-fix.
- Several verifiers on this stage: judge independently; quorum needs all of you.

## Verdict

Call `lodge_gate_submit_verdict`:

- PASS: one-line reason; `coverage` for every requirement (copy the requirement text; name the file you read, check you ran or output you saw); `outsideDiff` risk (无 if none). A PASS with an empty or unrelated coverage table is sent back once, then does not count.
- REJECT: one decisive reason; findings with severity and the failing check.

First line of your reply is 通过 or 不通过. Then name the next member in plain words; the system projects the @.
