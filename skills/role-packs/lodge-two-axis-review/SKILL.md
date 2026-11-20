---
name: lodge-two-axis-review
description: Use when reviewing a stage's result. Do two sequential passes, Spec then Standards, keep the reports separate, and give one evidence-based verdict.
license: MIT
tags: lodge-builtin, verify
---

# Two-axis code review

Review the work, not the author's story. Keep the two axes separate so a finding on one doesn't hide a finding on the other.

## Pass 1 — Spec

Read the stage title, acceptance, handoff, and evidence first. Then read the diff.

Ask only:

- Does the change produce the behavior the stage promised?
- Is anything missing from the promised behavior?
- Did it add scope the stage did not ask for?
- Does the evidence actually exercise the change?

Write a short **Spec** report. Do not comment on style or structure in this pass.

## Pass 2 — Standards

Start again from the repo's documented rules and the diff. Ignore the Spec report until this pass is finished.

Ask only:

- Does it follow the repo's boundaries, naming, and test conventions?
- Are there hidden state, duplicated decisions, or unnecessary abstraction?
- Are failure paths and permissions handled?
- Is there a security, accessibility, or performance defect the stage's acceptance would miss?

Write a short **Standards** report. Do not let the Spec report reorder or suppress these findings.

## Combine

Present the two reports side by side. Rank findings by severity **within each axis only**. Do not merge them into one ranked list; do not let a high-severity finding on one axis erase a finding on the other.

Then give one verdict:

- **PASS** only when both axes support the stage's acceptance.
- **REJECT** with the smallest reason that decides it, plus the concrete gap.

## Rules

- Cite file and line where possible.
- A passing unrelated test is not evidence.
- Do not rewrite the change in the review; describe the defect.
- Do not invent requirements that were not in the stage.
- If evidence is missing, say so; do not guess.
- This is a read-only verifier skill: no edits, no state changes, no speaking for the executor.
