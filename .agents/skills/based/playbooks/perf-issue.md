### Perf issue

**You own the measurement story. Measure, explain, fix, measure again.** Tie every fix to a measurement. Don't read source instead of measuring.

reeve has no tracing yet, so capture what the runtime gives you: `node --cpu-prof` for the server, the CLI or a vitest run, `EXPLAIN QUERY PLAN` for a slow SQL query, and the browser's Performance panel for the web app. Time the user-visible operation end to end (a budget month, a register page, a report, an import). Build the workload with a script that seeds a scratch book through operations at a realistic size (ten years of transactions, say), so the baseline can be rerun.

1. Capture a baseline on the matching surface. Vet it, and each later number, with the **benchmark-checklist** skill.
2. Run **how** to ground hypotheses. Don't claim a perf ceiling without running it first. Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop. An index is a schema change, so run **Schema change**. A stored budget figure is not an option, because the budget stays computed.

3. Plan the fix from the trace. If it crosses a function boundary, run **architect** first. Make the change, then capture a post-fix trace under the same conditions. Verify each attempt before trying the next (**principle-sequence-verifiable-units**).
4. Compare the artifacts with a script, not by eye. "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the commit body.
6. Run **Landing a change** when the task asks for commits.

**Reply:** baseline number, post-fix number, delta, artifact path.
