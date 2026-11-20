---
name: lodge-tdd
description: Use when implementing a stage or fixing a bug. Work in red-green-refactor vertical slices, with tests at the seams the stage promises.
license: MIT
tags: lodge-builtin, build
---

# TDD

A test is a promise about behavior. Write it before the implementation so you can see the promise fail for the right reason.

## Loop

1. Pick one vertical slice from the stage. Name the behavior and the seam.
2. Write the smallest failing test at that seam. Run it. Confirm it fails because the behavior is missing, not because the test is broken.
3. Write the smallest implementation that makes it pass. Do not add unrequested behavior.
4. Run the focused test, then the relevant suite.
5. Refactor with the tests green. Keep the interface small.
6. Repeat for the next slice.

## Test quality

- Test behavior through a public interface, not private helpers.
- One reason to fail per test.
- A test that passes whether or not the feature exists is not a test.
- Avoid horizontal slicing: all tests first, then all code. Finish one vertical slice at a time.
- If the seam is hard to test, fix the seam before adding more tests.

## Boundary

Work only in the assigned worktree. Do not commit, push, or open a PR. Run the checks the stage names; report the exact command and result.
