---
name: lodge-observability
description: Use when behavior needs evidence from logs, metrics, or traces, or when diagnosing a production issue. Instrument the smallest signal that can prove or disprove the claim.
license: MIT
tags: lodge-builtin, build, verify
---

# Observability

A claim about runtime behavior needs a signal. Add the smallest signal that distinguishes success from failure, then read it.

## Before instrumenting

- Name the question the signal answers.
- Define success and failure in observable terms.
- Choose the cheapest signal: existing test, command output, structured log, metric, or trace.
- Set a budget: one useful event beats a stream of noise.

## Instrument

- Emit structured events with stable names and bounded fields.
- Include the correlation id needed to connect a request, turn, or stage.
- Record duration, outcome, and error class where they matter.
- Never log secrets, tokens, cookies, credentials, or raw user content.
- Sample or aggregate high-volume paths; do not flood the log.

## Verify

- Read the actual signal after the change; do not infer it from code.
- For a bug, show the signal before and after.
- For a performance claim, report baseline and after with the same method.
- If the signal is missing, say so; do not call the stage done.

## Rules

- Logs are not a substitute for a test, and a test is not a substitute for a runtime signal.
- Observable failure is better than a silent fallback.
- Remove temporary instrumentation before delivery unless it is the evidence the stage promises.
- Read-only verification: do not change production behavior or external state to make a signal appear.
