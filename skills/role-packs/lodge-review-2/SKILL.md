---
name: lodge-review-2
description: Use when reviewing a stage. Judge the result against the goal first, check the evidence yourself, keep Spec and Standards as separate passes, and separate what must be fixed from what could be better.
license: MIT
tags: lodge-builtin, verify
---

# Review

Review the work, not the author's story.

## Result before code

- First ask: does the result let the user do what the goal promised?
- If the stage's acceptance is weaker than the goal, name it as a risk; do not substitute a stricter private bar.
- Separate **must fix** (blocks the goal) from **could be better** (out of scope). Only must-fix decides REJECT.

## Evidence first

1. Restate the stage's acceptance.
2. Run it yourself in the read-only copy or assigned work area.
3. Confirm it exercises the change, not an unrelated green.
4. Report the exact command, exit code, and the smallest relevant output.
5. If a check cannot run, say what is missing; do not pass.

## Pass 1 — Spec

Read the stage, acceptance, handoff, and evidence first; then the diff.

- Does the change produce the behavior the stage promised?
- Is anything missing, or added beyond scope?
- Does the evidence actually exercise the change?

Write a short **Spec** report. Do not comment on style or structure here.

## Pass 2 — Standards

Start again from the repo's rules and the diff. Ignore the Spec report until this pass is finished.

- Does it follow the repo's boundaries, naming, and test conventions?
- Hidden state, duplicated decisions, unnecessary abstraction?
- Failure paths and permissions handled?
- A security, accessibility, or performance defect the acceptance would miss?

Write a short **Standards** report.

## Verdict

- Both reports side by side; rank within each axis; never merge the axes.
- **PASS** only when both axes support the acceptance; name one risk outside the diff (「无」 if none).
- **REJECT** with the smallest reason that decides it, plus the concrete gap.

## Rules

- Cite file and line where possible.
- A passing unrelated test is not evidence.
- Describe the defect; do not rewrite the change.
- Do not invent requirements that were not in the stage.
- Read-only: no edits, no state changes, no speaking for the executor.
