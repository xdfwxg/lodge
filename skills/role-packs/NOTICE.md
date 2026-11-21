# Role skill packs

These are Lodge adaptations of MIT-licensed engineering skills.

## Upstream

- Matt Pocock, `mattpocock/skills`, v1.3.2, MIT:
  https://github.com/mattpocock/skills
  Used as the source for grilling, TDD, diagnosis, deep-module design,
  domain modeling, and retrospective ideas.
- Addy Osmani, `addyosmani/agent-skills`, MIT:
  https://github.com/addyosmani/agent-skills
  Used as the source for task breakdown, spec-driven planning, incremental
  implementation, simplification, frontend UI, API and interface design,
  observability, code review, security, accessibility, browser evidence,
  and performance.
- Jesse Vincent / `obra/superpowers`, MIT:
  https://github.com/obra/superpowers
  Used as the source for verification before completion.

## Adaptations

The Lodge versions are intentionally shorter and are bound to Lodge's room
model:

- no issue tracker, ticket graph, subagent dispatch, or automatic PR flow;
- planner skills are read-only;
- executor skills work only in the assigned worktree and forbid commit/push;
- verifier skills are read-only and end in evidence-based PASS/REJECT;
- skill names are prefixed with `lodge-` to avoid colliding with user skills;
- the verifier's two-axis review pack is `lodge-two-axis-review`; it replaces
  the earlier one-axis `lodge-code-review` pack.

The upstream projects remain under their own copyright and MIT license.
