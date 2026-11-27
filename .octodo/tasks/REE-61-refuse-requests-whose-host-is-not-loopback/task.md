---
id: REE-61
title: Refuse requests whose Host is not loopback
status: done
priority: medium
tags:
  - engine
created: 2026-11-02T23:00:33.756Z
order: a0
---

Measured 2026-11-02 on a scratch home: the server answers GET /api/books and a JSON POST that creates a book with `Host: evil.example`. A page that rebinds its domain to 127.0.0.1 is same-origin, so no preflight stops it. [boundaries rules](../../../docs/rules/boundaries.md) accepts this risk, but the check is small and protects the real book today. Allow only loopback hosts, then confirm the Vite proxy and the desktop app still work, and amend 0009. Found during REE-52.

## Status

Fixed in commit be4fcb4 with REE-52, merged to master in f78efe4.
