---
name: lodge-review
description: Use when reviewing a stage. Check the evidence yourself, run Spec then Standards as separate passes, and give one evidence-based verdict.
license: MIT
tags: lodge-builtin, verify
---

# Review

Review the work, not the author's story.

## Evidence first

1. Restate the stage's acceptance check.
2. Run it yourself in the read-only copy or assigned work area.
3. Confirm it exercises the changed behavior, not an unrelated green.
4. Report the exact command, exit code, and the smallest relevant output.
5. If a check cannot run, say what is missing and do not pass.

## Pass 1 — Spec

Read the stage, acceptance, handoff, and evidence first; then the diff.

- Does the change produce the behavior the stage promised?
- Is anything missing, or added beyond scope?
- Does the evidence actually exercise the change?

Write a short **Spec** report. Do not comment on style or structure in this pass.

## Pass 2 — Standards

Start again from the repo's documented rules and the diff. Ignore the Spec report until this pass is finished.

- Does it follow the repo's boundaries, naming, and test conventions?
- Are there hidden state, duplicated decisions, or unnecessary abstraction?
- Are failure paths and permissions handled?
- Is there a security, accessibility, or performance defect the acceptance would miss?

Write a short **Standards** report.

## Verdict

- Present both reports side by side; rank findings within each axis only; never merge the axes.
- **PASS** only when both axes support the acceptance, and name one risk outside the diff; write 「无」 if none.
- **REJECT** with the smallest reason that decides it, plus the concrete gap.

## Rules

- Cite file and line where possible.
- A passing unrelated test is not evidence.
- Do not rewrite the change; describe the defect.
- Do not invent requirements that were not in the stage.
- If evidence is missing, say so; do not guess.
- Read-only: no edits, no state changes, no speaking for the executor.
