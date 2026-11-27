### Schema change

**You own the books that already exist. A migration runs on the user's real money, and a committed migration never changes.**

1. Edit `engine/src/db/schema.ts`, or `engine/src/receipts/schema.ts` for the receipts module. Column names are snake_case and spelled out. Money is an integer of cents, a day an integer `YYYYMMDD`, a month `YYYYMM`.
2. A new table goes into `UNDONE_TABLES` in `db/open.ts`. A table left out there silently escapes undo.
3. A new reference across modules goes one way: receipts point at the ledger by id, never back. If rows can be merged (payees, transactions), carry the reference along in the composition root `operations.ts`.
4. Run `pnpm db:generate`. It writes the migration and bundles it into `db/migrations.gen.ts`. Read the generated SQL. If it is wrong, fix the schema and regenerate before committing. Never edit a committed migration: write a new one.
5. Backfill in the migration when old rows need a value. Think about what existing rows mean under the new column, since no default is neutral on real data.
6. Prove the upgrade on a book that predates the change. Create it with the code before your change (a worktree at `HEAD`, `REEVE_HOME=<tmp>`), seed it through operations, then open that same home with your code and read it back. Never use a copy of the real book for this unless the user offers one.
7. Test through operations, including `undo` and `redo` over the new table, plus `export_book` and `restore_book` when the data should survive a backup.

**Reply:** the schema change, the generated migration's path, the backfill and why it is correct, the upgrade run's output, and the undo result.
