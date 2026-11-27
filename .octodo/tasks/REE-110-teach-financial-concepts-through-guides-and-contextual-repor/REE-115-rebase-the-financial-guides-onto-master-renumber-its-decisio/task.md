---
id: REE-115
title: Rebase the financial guides onto master, renumber its decision, and merge
status: todo
priority: medium
tags:
  - docs
  - integration
created: 2026-11-08T12:29:17.816Z
order: a3
---

The Guides work is committed on `feature/financial-guides` in the worktree `~/code/reeve-guides`, branched from a02b05d. Master has since gained REE-96 (pane guard, [panes and alerts rules](../../../../docs/rules/panes-and-alerts.md)), REE-97 and the budget drill-down ([reports rules](../../../../docs/rules/reports.md)), and the footer move (65b09a2), which the branch also carries as its own copy. Before merging: rebase onto master, drop the branch's duplicate footer changes in favour of master's, renumber its `0057-guides-teach-financial-concepts-in-context.md` to the next free number (0059) and fix every link and the decisions index, then run `pnpm check` and the guides, footer, docs, apps and findability e2e. The board copy of REE-110 and its subtasks lives on master; drop any `.octodo` copy on the branch.
