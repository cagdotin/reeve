---
id: REE-140
title: Investment holdings and market-value tracking
status: todo
priority: medium
tags:
  - feature
  - investments
created: 2026-11-12T00:19:16.136Z
order: ad
---

## Problem

Off-budget investment accounts in reeve only record net cash contributed (transfers in minus transfers out). They cannot show units, prices, or current portfolio value.

Concrete case: A Revolut account. Money sent to Revolut Invest, Robo Portfolio, and Aggressive Growth Portfolio can already be recorded as transfers into an off-budget “Revolut Invest” asset, so it stays out of the budget. That account’s balance would be net cash in, not what the portfolio is worth. Gains, losses, dividends, and market price are invisible. Net worth and reports therefore under- or over-state investment assets.

An earlier book tried off-budget “Revolut Invest” / “Revolut Robo portfolio” accounts; same limitation.

## What we need

Investment account tracking beyond cash transfers, for example:

- Holdings (units / shares) and a current price, or a manually entered market value
- Portfolio value that can differ from net contributions (unrealized gain/loss)
- Optionally cost basis vs market value on net worth and reports

Revolut Robo / Invest (and similar brokerage accounts) should be first-class to track, not only “money we sent there.”

## Workaround today

Create an off-budget asset, turn “To/From Robo Portfolio”, “To Aggressive Growth Portfolio”, and “To/From Investment Account” into transfers. Budget spending is excluded correctly; the balance is cash contributed only. Not a substitute for holdings or market value.

## Out of scope for this ticket

Linking Erste→Revolut top-ups and tracking a loan liability (those are doable with existing transfer rules, accounts, and schedules).
