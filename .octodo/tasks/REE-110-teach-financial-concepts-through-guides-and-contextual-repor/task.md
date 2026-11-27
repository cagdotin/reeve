---
id: REE-110
title: Teach financial concepts through Guides and contextual report links
status: in-progress
created: 2026-11-08T08:34:35.661Z
order: aG
---

Uncommitted implementation in a separate worktree on feature/financial-guides. Preview http://127.0.0.1:5621/guides uses a scratch home. Incorporated only the main checkout footer changes and matching navigation tests; unrelated in-flight main work remains untouched. Guides is a desktop footer utility next to Shortcuts and Docs and remains in phone navigation.

Expanded to 12 question-led lessons with observable outcomes, worked reasoning, optional immediate-feedback practice, explicit page actions, related guides, and limitations. Added 33 glossary entries with definitions, examples, distinctions, related terms, searchable URLs, and explicit wiki links that preview on hover/focus and navigate on click/tap. No financial writes, answer persistence, scoring, or mastery claims. Teaching approach adapts Matt Pococks teach skill, with rationale and source gaps in docs/specs/learning-experience.md. [panes and alerts rules](../../../docs/rules/panes-and-alerts.md) and architecture docs updated.

Verification: pnpm check:push passes, including 2048 unit tests. Integrated guides/footer/docs/apps/findability E2E passes, 59 tests. Desktop bundle verification passes. Screenshots at /tmp/reeve-learning-screenshots cover library/reader/glossary at 390/1440 in Day/Night. Manually exercised the live scratch preview using agent-browser; feedback screenshot at /tmp/reeve-learning-practice.png. Known unrelated full-suite account-scope failure remains REE-109. No commit, merge, or real-book access.

REE-111 tracks shared report controls. REE-112 now has a draft Monte Carlo guide in the preview, but simpler report controls/results and additional model education remain pending. Source review task tracks editorial gaps. Personal learning profiles and spaced-review scheduling remain undesigned; do not infer learning from page views or a single answer.
