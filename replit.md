# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Recharts + framer-motion

## Product: Ascent 1.0

A continuous improvement operational intelligence platform — an air traffic control tower for teams managing workflows, assets, and operational health.

### Core Features

1. **Control Tower Dashboard** — Full intelligence layer: OHS gauge, 4 dimension cards, Trend Signals strip, Priority Actions panel (with rich reasons), Primary Bottleneck story, Stage Distribution bar chart, Workflow Spotlight ranking
2. **Workflow Engine** — Create/manage workflows, break into stages, track movement, detect bottlenecks, health recalculation
3. **Stoplight Scoring** — Red/Yellow/Green system at stage, workflow, and global levels
4. **Asset & Warranty Tracking** — Asset registry with warranty lifecycle, health scores, maintenance schedules
5. **Alert Engine** — Automated 6-rule evaluator (critical items, overdue, aging, bottleneck, health score drops, unassigned high-priority) with deduplication via ruleKey, lifecycle management (active → acknowledged → resolved), category/level filters, per-workflow alert badges
6. **Analytics & Trends** — Score trend charts, workflow performance tables
7. **Document Engine** — Link documents/evidence to workflows, stages, and assets
8. **Assignment Engine** — CSV/work-order ingestion, Levenshtein matching against units/properties, confidence scoring (high→auto-assign, medium→confirm, low→review queue), manual assignment fallback, unit history integration
9. **Work Order Ingestion + Bottleneck Detection** (Build 2.5) — 13-field extended schema (turn/stage/block/bottleneck), 67-row stress-test CSV imported (3 property clusters), fuzzy property matching, stage congestion analysis, blocked turn detection, 3 new drill signals (blocked_turns, stage_congestion, rework_loop)
10. **Work Order Impact + Priority Engine** (Build 2.6) — Deterministic impact scoring formula (time × category weight × block multiplier × priority multiplier × repeat multiplier), category/property/regional aggregation, Top-3 operational priorities with ranked cards + reason text, property impact ranking with progress bars, dashboard Priority Panel (`woTopPriorities` in intelligence bundle), `GET /api/work-orders/impact` endpoint
11. **Turn Matrix Engine** (Build 1.10) — Real data-driven turn/make-ready intelligence; `turns` table with full schema; weighted completion % calculation; blocked turn detection (7-day threshold); rework logic; rent-ready status; bottleneck aggregation (stage/property/org level); CSV ingestion with fuzzy property matching; full Turns page with stats strip, bottleneck intelligence, stage congestion map, property breakdown table, filterable turn list; `turnStats` in dashboard intelligence bundle; endpoints: `POST /api/turns/import`, `POST /api/turns/reset`, `GET /api/turns`, `GET /api/turns/stats`, `GET /api/turns/matrix`
12. **Turn → Control Tower Wiring** (System Correction) — Turn data registered as first-class scoring inputs to all 4 Overview dimension cards; `blocked_turns`, `stage_congestion`, `rework_loop` drill signals re-queried against `turnsTable` (not work_orders); new `not_rent_ready` signal added (drill + UI); OHS Driven By block shows turn signals (blocked turns, rework); Flow/Risk/Execution reveal panels each have a "Turn-Derived Inputs" section with clickable drill-through to real turn records; Improvement card shows explicit "not yet connected" state with explanation; primary cause + recommended action text in all 4 cards is turn-aware when data exists; `TurnStats` type added to `DashboardIntelligence` in frontend generated schema
13. **Turn Context + Property/Unit Propagation** (Build 1.10.8) — Full system hierarchy enforcement (Organization → Property → Unit → Turn); `getTurnStatsByProperty(propertyId)` added to turn-matrix-service; `GET /api/turns/stats?propertyId=X` scopes stats to a single property; `GET /api/turns/unit/:unitId` returns enriched turn records for a unit (sorted active-first); Property Detail page gains "Turn Overview" section with property-scoped metrics (total, blocked, not-rent-ready, avg completion, bottleneck stage) each clickable to drill-down scoped to that property; Driven By block on property page shows turn bullets with property-scoped drill; Unit Detail page gains "Turn Status" section with active turn details (stage, completion bar, days in stage, rent-ready status, inspection pass/fail, blocked state + reason, explanation text), plus turn history if multiple records exist; "not connected" empty state shown when no turns for that unit/property
14. **Contextual Turn Impact Engine** (Build 1.10.9) — All 4 dimension scores (Flow/Risk/Execution/Improvement) are now fully property-scoped when turn data exists; `computeTurnScores()` helper computes turn-derived scores client-side from property-scoped `TurnStats`; Flow = avgCompletion - (blockedRate*40) - (reworkRate*15); Risk = 100 - (blockedRate*50 + notRentReadyRate*30 + reworkRate*20); Execution = avgCompletion*0.5 + completedRate*100*0.5; Improvement = completedRate*60 + rentReadyRate*40; Dimension card scores replaced with turn-derived values when turn data is present (with updated descriptions: "Turn-stage throughput · property-scoped", "Blocked + not-rent-ready pressure", etc.); All 4 reveal panels (FlowReveal, RiskReveal, ExecutionReveal, ImprovementReveal) show turn-scoped metrics when available; Primary Cause + Recommended Action text in all 4 reveal panels uses property-scoped turn data when available; Graceful fallback to asset/warranty-based scores when no turn data exists for a property
15. **Control Tower Source Override** (Build 1.10.10) — Main Control Tower dashboard (Overview page) now uses ONLY turn-derived scores for all display; `computeOrgTurnScores()` computes org-level Flow/Risk/Execution/Improvement/OHS from `intel.turnStats`; OHS gauge shows turn-derived score (42, yellow) instead of workflow-based score (25, red); 3 stat pills replaced (Critical/Active/Overdue → Blocked/Active/Not Ready); Driven By block now shows ONLY turn signals: blocked turns, units not rent-ready, stage bottleneck, rework — no workflow item language; all 4 dimension cards use `turnScores` with turn-derived stoplights and turn-based insight text; MetricRevealSection `why` text for all 4 metrics is turn-first when turn data available; primaryCause text purged of all "items", "workflow", "critical items", "overdue items" language; system-wide authority: Control Tower = Turn System Only; graceful fallback to workflow-based data when no turn data exists

### Calculation Engine

- **Flow Score**: measures stage completion, bottlenecks, blocked stages
- **Risk Score**: measures overdue/blocked exposure
- **Improvement Score**: measures completion progress
- **Execution Score**: measures follow-through
- **Operational Health Score**: composite average of all four

### Score to Stoplight Mapping

- ≥75 → Green
- 50-74 → Yellow
- <50 → Red

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── ascent/             # Ascent 1.0 React+Vite frontend (serves at /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
│   └── src/seed.ts         # Database seed script
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- `workflows` — Workflow records with scores and stoplight
- `stages` — Workflow stages with status, bottleneck flag, owner
- `impact_events` — Events that changed workflow timelines/costs
- `assets` — Assets with warranty, health, maintenance data
- `alerts` — System alerts with severity levels
- `documents` — Evidence/documents linked to workflows/assets
- `properties` — Properties (buildings/locations) with optional address
- `units` — Units belonging to properties with optional JSON metadata

## Scoring Engine (Phase 1 – Build 3)

Lives in `artifacts/api-server/src/engine/`:

- **`scoring.ts`** — Pure calculation utilities: `calcFlow`, `calcRisk`, `calcImprovement`, `calcExecution`, `calcWorkflowHealth`, `calcOperationalHealth`. Zero DB access.
- **`loader.ts`** — Assembles `WorkflowInput` objects from DB (items + stages + history). Used by all routes that need real scoring.

**Stoplight thresholds (centralized):** ≥75 = green, 50–74 = yellow, <50 = red

**Workflow health weights:** Flow 30% · Risk 30% · Execution 25% · Improvement 15%

All four dashboard score cards, the workflow list, the workflow detail health panel, and the analytics performance endpoint use this shared engine. Random noise/placeholder math has been eliminated.

## Alert Engine (Phase 1 – Build 4)

Lives in `artifacts/api-server/src/engine/alerts.ts`:

**6 Rule Evaluators:**
- `evaluateCriticalItems` — flags every open critical-priority item
- `evaluateOverdueItems` — flags items past their due date (severity scales with priority)
- `evaluateAgingItems` — items >7d in same stage (warning), >21d (critical)
- `evaluateBottleneck` — stages with ≥2 open items concentrated
- `evaluateWorkflowHealth` — health <75 → warning alert, <50 → critical alert
- `evaluateUnassignedCritical` — critical/high items with no assigned owner

**Deduplication:** Each rule produces a stable `ruleKey` (e.g. `critical_item_3`, `bottleneck_1_2`). On each evaluation run, existing alerts with matching ruleKeys are updated (`lastSeenAt`), new alerts are inserted, and alerts whose condition no longer holds are automatically resolved.

**Alert lifecycle:** `active` → `acknowledged` → `resolved`

**Auto-evaluation triggers:** On API server startup (non-blocking); manually via `POST /api/alerts/evaluate`

**Frontend integration:**
- Alert Center page: summary strip, tabs (Active/Acknowledged/Resolved/All), level + category filters, per-alert actions
- Workflow list: alert badge (critical/warning count) per workflow card
- Workflow detail: "Active Alerts" panel in the right column with inline acknowledge/resolve

## Document Engine (Phase 1 – Build 6)

GCS object storage with a full document management pipeline:

**Storage:** Google Cloud Storage bucket via `lib/object-storage-web` client + `ObjectStorageService` (server)

**Two-step upload flow:**
1. Frontend requests a presigned upload URL: `POST /api/documents/upload-url`
2. Browser uploads directly to GCS via presigned URL (no proxy through API server)
3. Frontend registers the document: `POST /api/documents`

**Documents table schema:** `linkedEntityType` (workflow/workflow_item/workflow_stage/asset), `linkedEntityId`, `linkedWorkflowId`, `linkedStageId`, `objectPath`, `fileName`, `fileType`, `fileSizeBytes`, `documentType`, `uploadedAt`

**Frontend integration (`document-panel.tsx`):**
- `DocumentPanel` — full panel with upload form (drag-drop + camera), document list, preview modal
- `DocumentCountBadge` — small badge for item cards showing document count
- Upload via Uppy with AWS S3 presigned URL flow
- Integrated into `ItemDetailSheet` in workflow-detail.tsx
- ItemCard footer shows document count badge when docs exist

## Reaction Layer (Build 1.8)

Implemented throughout the UI: every major operational signal is clickable and opens a `DrillDownSheet` panel showing supporting records.

**Backend:** `GET /api/drill?signal=X&propertyId=Y&workflowId=Z&stageId=W` — returns structured `DrillResponse` (label, trigger explanation, rows). Supports 7 signal types: `expired_warranty`, `expiring_soon`, `critical_items`, `overdue_items`, `bottleneck_items`, `stale_items`, `at_risk_workflows`.

**Frontend components:**
- `drill-down-sheet.tsx` — Right-side Sheet panel with signal context, scrollable rows, navigate-to links
- `use-signal-drill.ts` — Hook to fetch `/api/drill` with signal params

**Wired pages:**
- **Control Tower** (`dashboard.tsx`): StatPills (critical/overdue), Driven By bullets, Asset Health Pulse (expired/expiring), FlowReveal bottleneck, RiskReveal critical/overdue, ExecutionReveal stale workflows
- **Property Control Tower** (`property-detail.tsx`): Asset Health stats (Expired Warranty, Expiring 90d), Operational Signals Critical Items count
- **Properties list** (`properties.tsx`): Critical item badges and aging badges per property card (outside card button to avoid nesting)
- **Alert Center** (`alerts.tsx`): Critical and Warning summary tiles

## Financial Intelligence Engine (Build 1.9)

Adds real replacement-cost data throughout the platform — every warranty signal now shows dollar exposure in addition to asset counts.

**Backend cost service:** `artifacts/api-server/src/lib/cost-lookup.ts` — maps 4 DB asset types to benchmark replacement costs: Stove=$825, HVAC Unit=$5,000, Refrigerator=$850, Water Heater=$875.

**Drill route (`/api/drill`):** `DrillRow` includes `cost` field; `DrillResponse` includes `totalCost` + `costMatchedCount`; each `expired_warranty` / `expiring_soon` row carries a per-asset replacement cost lookup.

**Portfolio service (`portfolio_control_tower.ts`):** Each `PropertyPortfolioCard` now includes `totalAssetCost`, `expiredWarrantyCost`, `expiringSoonCost` (null when no priced assets exist for that category).

**DrillDownSheet footer:** Shows "Total Replacement Exposure" with dollar amount + unmatched-asset footnote when cost data is available.

**Property Control Tower (`property-detail.tsx`):**
- Asset Health cards show dollar exposure beneath expired/expiring counts ("$X exposure", "$Y at risk")
- Financial Intelligence panel (3 cells): Total Asset Value · Expired Exposure (clickable) · 90d Risk (clickable)

**Dashboard (`dashboard.tsx`):** Asset Health Pulse card shows "Replacement Exposure" strip below counts — portfolio-wide Total Portfolio Value · Expired Exposure (clickable) · 90d At Risk (clickable).

**Unit Detail (`unit-detail.tsx`):** Unit Cost Summary strip above asset list — Total Replacement Value · Expired Exposure · 90d At Risk (only when assets have priced types). Per-asset replacement cost badge shown inline.

## API Endpoints

| Module | Routes |
|---|---|
| Dashboard | `GET /api/dashboard/summary`, `/bottlenecks`, `/actions`, `/intelligence` |
| Workflows | `GET/POST /api/workflows`, `GET/PUT/DELETE /api/workflows/:id`, `GET /api/workflows/:id/health` |
| Stages | `GET/POST /api/workflows/:id/stages`, `PUT/DELETE /api/workflows/:id/stages/:stageId` |
| Workflow Items | `GET/POST /api/workflows/:id/items`, `GET/PUT/DELETE /api/workflows/:id/items/:itemId` |
| Item Movement | `POST /api/workflows/:id/items/:itemId/move`, `GET /api/workflows/:id/items/:itemId/history` |
| Bottleneck | `GET /api/workflows/:id/bottleneck` |
| Assets | `GET/POST /api/assets`, `GET/PUT/DELETE /api/assets/:id`, `GET /api/assets/warranties` |
| Alerts | `GET /api/alerts` (with filters: level/category/status/isActive/workflowId), `GET /api/alerts/summary`, `POST /api/alerts/evaluate`, `PATCH /api/alerts/:id/read`, `PATCH /api/alerts/:id/acknowledge`, `PATCH /api/alerts/:id/resolve` |
| Documents | `GET /api/documents` (with filters: entityType/entityId/workflowId), `POST /api/documents`, `DELETE /api/documents/:id`, `POST /api/documents/upload-url`, `GET /api/storage/objects/{*objectPath}` |
| Analytics | `GET /api/analytics/trends`, `/workflow-performance` |
| Properties | `GET /api/properties`, `POST /api/properties`, `DELETE /api/properties/:id` |
| Units | `GET /api/units` (with filter: propertyId), `POST /api/units`, `POST /api/units/import` (bulk with dupe-skip), `DELETE /api/units/:id` |

## Development Commands

- `pnpm --filter @workspace/api-server run dev` — Run API server
- `pnpm --filter @workspace/ascent run dev` — Run frontend
- `pnpm --filter @workspace/db run push` — Push DB schema
- `pnpm --filter @workspace/scripts run seed` — Seed database
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client hooks

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files during typecheck
