### Bug fix

**You own this task. Reproduce, root-cause, fix, verify.** If the complaint is that a figure is wrong, start at **Wrong number**.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the surface where it was reported (see **Verify on the real surface** in `../SKILL.md`), in a scratch home. Ask the user only with a specific reason the surface is out of reach, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with **how** over the affected subsystem and **why** for regression history (`git log` on the files, the octodo task that asked for the change). Check whether Actual has the same behavior before you call it a bug. When state is unclear, query the scratch book's SQLite file or add a temporary log you delete before commit. Don't guess. Confirm the surviving _mechanism_ with runtime evidence before you plan the fix.
3. Plan the fix. If it crosses a function boundary, run **architect** first. Fix it at the root (**principle-fix-root-causes**), and fix every other site with the same fault.
4. If the bug has already written bad data, say which books and rows it reaches, and whether a migration should repair them. Never repair the real book without asking.
5. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Stage the commits so the failing repro lands before the fix. Use the **tdd** skill when the bug has a cheap test path, which is usually true for `packages/engine` (`scratch()` and `call`). This is the canonical **principle-sequence-verifiable-units** shape.
7. Run **Landing a change** when the task asks for commits.

**Reply:** what was broken, root cause, fix, how you verified. Paste the failing-then-passing repro output verbatim.
