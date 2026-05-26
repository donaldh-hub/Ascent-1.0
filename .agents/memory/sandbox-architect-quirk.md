---
name: code_execution sandbox lists `architect` but cannot invoke it
description: The `architect` callback appears in code_execution globals but throws "architect is not a function" when called; route review work through `subagent` instead.
---

In the code_execution sandbox, `typeof architect === 'function'` is true and `architect` is listed in `Object.keys(globalThis)`, but `await architect({...})` throws `TypeError: architect is not a function`. Reassigning via `globalThis.architect` does not help.

**Why:** Sandbox quirk — the binding is exported as a property descriptor but the underlying callable is not wired up. Trying to call it just wastes a turn.

**How to apply:** When you need an architect-style review, dispatch via `subagent(...)` (per the `delegation` skill) with an explicit REVIEW-ONLY task description, the relevant file paths, and a required output format ending in a `Verdict: SHIP / FIX-THEN-SHIP / DO-NOT-SHIP` line. Works reliably and returns the same structured review.
