---
id: REE-74
title: "Flaky e2e: openAccount times out finding the account in the scope dropdown"
status: done
priority: medium
tags:
  - testing
created: 2026-11-05T10:12:46.369Z
order: a7
---

During full `pnpm check` runs on 2026-11-05, `openAccount` (`packages/e2e/src/fixtures.ts:109`) timed out waiting for the account's `menuitemradio` in the Accounts scope dropdown, failing 2 of 3 consecutive runs and so able to block the pre-push hook. Each run failed in a different test:

- `rules.e2e.ts`: saving a rule's category recategorizes the transactions it matches (`/^Checking 954.80/`)
- `mobile.e2e.ts`: on a phone, a transaction added from an account's list counts in the budget (`/^Checking 1,000.00/`)

On their own, those files passed 4 of 4 and 5 of 5 runs, so it seems to need the load of the full suite.

The balance is not simply stale: the mobile test had no write after creating the account. A guess, not yet confirmed: the helper clicks the dropdown right after the rail link, and the header remounts when the lazily loaded page arrives (`PageHeader` portals it into a slot), closing the menu it just opened. If so, a person on a slow load could see this too, so reproduce under load and check that before adding a retry to the helper.
