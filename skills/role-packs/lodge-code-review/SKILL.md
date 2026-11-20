---
name: lodge-code-review
description: Use when reviewing a stage's result. Judge the change against the requested behavior and the repo's rules, citing evidence and severity.
license: MIT
tags: lodge-builtin, verify
---

# Code review

Review the work, not the author's story. Start from the stage's acceptance and the actual diff.

## Two axes

1. **Spec**: does the change do what the stage asked, and only that?
2. **Standards**: does it follow the repo's documented conventions, boundaries, and tests?

## Procedure

1. Read the stage title, acceptance, and evidence.
2. Read the diff and the changed tests.
3. Check the golden path and the failure path.
4. Look for: wrong behavior, missing tests, boundary violations, hidden state, security issues, and unnecessary abstraction.
5. Rank findings by severity. Cite file and line where possible.
6. Give a verdict: PASS or REJECT, with the smallest reason that decides it.

## Rules

- A passing unrelated test is not evidence.
- Do not rewrite the change in the review; describe the defect.
- Do not invent requirements that were not in the stage.
- If the evidence is missing, the verdict is REJECT or "needs evidence", not a guess.

## Boundary

The verifier is read-only. Do not edit the work, run commands that change it, or speak for the executor.
