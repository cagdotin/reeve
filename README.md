<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/png/logo-dark.png">
  <img alt="reeve" src="docs/brand/png/logo-light.png" height="64">
</picture>

**Your financial steward.**

Local-first personal budgeting on a double-entry ledger. reeve does what
[Actual Budget](https://github.com/actualbudget/actual) does (envelope or tracking budgets,
accounts, rules, schedules, reports, budget targets) and runs on one computer only. It has no accounts
to sign in to and no server to deploy, and reads your banks through a provider you register with
yourself ([bank sync](docs/bank-sync.md)). It also supports categories nested inside categories.

Purchases (itemized receipts, products and item prices) is [frozen and hidden](docs/specs/purchases-freeze.md)
while work focuses on financial correctness. Its implementation and existing data are retained;
whether it returns as a built-in module or a plugin is undecided.

Everything the app can do, agents can do too: each operation is defined once and served as an HTTP
API, MCP tools, a `reeve` CLI and an agent skill.

## How your money is kept

- A **book** is one SQLite file: `~/.config/reeve/books/<id>.sqlite` (or under `REEVE_HOME` if it
  is set). The first time you open reeve it creates "My Budget".
- Every transaction is made of **postings** that add up to zero. Budget categories are income and
  expense accounts inside the ledger, so all your money is always accounted for.
- The **budget** is computed from the ledger and never stored. Money you budget but don't spend
  rolls over to the next month, as in Actual.
- **Targets** ("save 600 by June", "100 every month") are set in a form from the target icon next
  to each category. They are stored as Actual-style template lines in the category's notes.
- **Legacy purchases data** stays in existing books and backups, including receipt photos in
  `~/.config/reeve/receipts/<book>/<receipt>/`. Already-applied transaction splits remain ordinary
  financial transactions. Purchase operations and screens are unavailable while frozen.
- **Import** bank statements as CSV, OFX/QFX, QIF or CAMT. You can **export** transactions as CSV,
  or the whole book as a backup.
- **Undo** and **redo** work on every change, from the app, the CLI or an agent.

## Run it

reeve isn't packaged yet, so run it from a checkout:

```sh
mise run setup      # Node 26, pnpm 12, gitleaks and the dependencies
pnpm dev            # the desktop app (Electron + Vite)
pnpm dev:web        # or: API + Vite, in your browser
```

### CLI

```sh
bin/reeve --help                     # every command
bin/reeve accounts list
bin/reeve budget show
bin/reeve transactions ls
bin/reeve import preview <file>      # see what a bank file would import, then `import run`
bin/reeve undo
bin/reeve serve                      # web app, API and MCP on http://127.0.0.1:4620
```

Use `--book <id>` to work on a book other than the default (see `reeve books`). To run `reeve`
without the `bin/` prefix, link it onto your PATH: `ln -s "$PWD/bin/reeve" ~/.local/bin/`.

When the app or `reeve serve` is running, the CLI talks to it, and the app updates live. When
neither is running, the CLI opens the book directly.

### Agents

```sh
claude mcp add reeve -- /path/to/reeve/bin/reeve mcp   # MCP over stdio (Claude Code shown)
bin/reeve skills export                                # write the reeve agent skill
```

While the app or `reeve serve` is running, MCP is also served over HTTP at
`http://127.0.0.1:4620/mcp`, and the API at `/api` (OpenAPI at `/api/openapi.json`). The server
only answers on this computer and asks for no credentials.

## Develop

```sh
pnpm check              # format, lint, react-doctor, typecheck, unit + e2e tests, desktop bundle check
pnpm catalog:generate   # after changing an operation in packages/contract/src/catalog/
pnpm db:generate        # after changing the Drizzle schema
```

Tasks live in octodo (`octo ls`, key `REE`). See [AGENTS.md](AGENTS.md) for the model, the layout and
the conventions, and [docs/](docs/README.md) for the architecture and the decisions behind it.
