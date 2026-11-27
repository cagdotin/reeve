### Feature

**You own the design and the build. Ground, shape, build, verify.** If Actual has this feature, start at **Actual parity** instead.

1. **how** over the affected subsystem.
2. **architect** for the shape: data first, then signatures and module boundaries.
3. Write the throughput checkpoint as four todo items. A dimension that does not apply keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** What must land before anything else. Usually a schema in `packages/contract/src/` that the engine, MCP, CLI and web all derive from.
   - **Independent workstreams.** Disjoint packages or layers that could proceed in parallel. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (**principle-separate-before-serializing-shared-state**). Serialize only for real invariants.
   - **Smallest safe decomposition.** Usually one owner, you. Name why when it isn't.
4. Build it yourself against the sketch, composing **Operation**, **Schema change** and **Screen** as they apply. Name the data shape and its organizing structure first per **principle-model-the-domain**. Keep to the one-way package order and the browser bundle's import rules in `AGENTS.md`. A new domain is a new folder with its own tables that point at the ledger by id, as receipts does ([purchases rules](../../../../docs/rules/purchases.md)). Comments per **Comments**.
5. Verify on the matching surface (see **Verify on the real surface**). "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Shape the history into small, ordered commits per **principle-sequence-verifiable-units**.
7. If the design is contested, or the diff is large enough that you would want a second reader, run **interrogate**.
8. Move the octodo task to `done` and run **Landing a change** when the task asks for commits.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
