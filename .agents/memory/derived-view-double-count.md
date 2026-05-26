---
name: Derived-view double-count in shared ingestion summaries
description: When a new reporting source is a *view* over an existing source (same raw rows, different sourceType/id namespace), naively folding it into the shared all-records pool inflates baseline summary tiles.
---

When a new reporting source is a derived **view** over an existing source — same raw rows re-emitted under a new `sourceType` and a distinct id namespace — do NOT add it to the shared "all records" pool that feeds global summary tiles.

**Why:** The global ingestion summary counts every record in the pool once. A derived view re-emits the same raw row a second time, so totals (`totalRecordsReviewed`, `fullyReportableCount`, etc.) inflate by exactly the derived count the first time real data lands in that view. The regression is silent in low-data dev datasets and breaks any locked-baseline tiles downstream.

**How to apply:** Keep derived views in the per-source readiness map (so they get their own readiness row and drill-downs), but skip them when assembling the cross-source pool that builds the global summary. An explicit `DERIVED_VIEW_SOURCES` set near the orchestrator makes the intent grep-able and review-friendly. Examples of "derived view": PM mapping over work_orders, evidence/cross-category roll-ups, anything whose normalizer reads another source's table.
