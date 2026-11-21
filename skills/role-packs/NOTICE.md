# Role skill packs

These are Lodge-authored engineering skills. They synthesize ideas from
MIT-licensed skill collections; the wording and structure are Lodge's.

## Upstream

- Matt Pocock, `mattpocock/skills`, v1.3.2, MIT:
  https://github.com/mattpocock/skills
  Source for grilling, TDD, diagnosis, deep-module design, and domain modeling.
- Addy Osmani, `addyosmani/agent-skills`, MIT:
  https://github.com/addyosmani/agent-skills
  Source for task breakdown, spec-driven planning, incremental implementation,
  simplification, frontend UI, API and interface design, observability, code
  review, security, accessibility, browser evidence, and performance.
- Jesse Vincent / `obra/superpowers`, MIT:
  https://github.com/obra/superpowers
  Source for verification before completion.

## Lodge packs

- `lodge-plan` — grilling, spec-driven planning, task breakdown.
- `lodge-design` — deep modules, domain modeling, API and interface design.
- `lodge-build` — TDD, incremental implementation, simplification.
- `lodge-diagnose` — the diagnosis loop.
- `lodge-ui` — frontend UI, browser evidence, accessibility.
- `lodge-review` — two-axis review, verification before done.
- `lodge-security` — security review.

## Adaptations

- no issue tracker, ticket graph, subagent dispatch, or automatic PR flow;
- planner skills are read-only;
- executor skills work in the assigned work area and forbid commit/push;
- verifier skills are read-only and end in evidence-based PASS/REJECT;
- skill names are prefixed with `lodge-` to avoid colliding with user skills.

The upstream projects remain under their own copyright and MIT license.
