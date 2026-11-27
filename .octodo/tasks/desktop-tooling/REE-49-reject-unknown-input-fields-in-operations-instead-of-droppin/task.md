---
id: REE-49
title: Reject unknown input fields in operations instead of dropping them
status: done
priority: medium
tags:
  - api
created: 2026-11-01T08:26:10.124Z
order: a6
---

Effect Schema structs drop excess keys, so an agent sending `store` instead of `payee` to create_receipt gets a receipt with no store and no error. Decode operation inputs with onExcessProperty: "error" (HTTP, MCP, CLI) and add a test.
