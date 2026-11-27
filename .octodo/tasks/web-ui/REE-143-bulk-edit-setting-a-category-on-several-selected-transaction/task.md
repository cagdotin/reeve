---
id: REE-143
title: "Bulk edit: setting a category on several selected transactions and saving closes the pane but changes nothing"
status: done
priority: high
tags:
  - bug
  - ui
  - transactions
created: 2026-11-12T17:54:43.743Z
order: aA
---

Reported by the owner, 2026-11-12, in the desktop app. Select several transactions on Transactions, set a category in the pane, press Save: the pane closes but no transaction gets the category.

Use the Bug fix playbook. Reproduce on a scratch home in the real web app (e2e), never the real book. Check whether the save sends nothing, sends the wrong ids, or the server refuses it quietly, and whether an error gets swallowed instead of shown (panes-and-alerts.md). Related: REE-141 (learn on bulk update_transactions), REE-142 (bulk-applying rules).

**Done when:** an e2e test selects several transactions, sets a category, saves and sees every row carry it, with one undo step; a failed save keeps the pane open and says why.

Result: merged to master (fast-forward, 89d361b, e26b0fc). Bulk categorize pane saves as one write and one undo.
