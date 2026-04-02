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

1. **Control Tower Dashboard** — Operational Health Score (composite of Flow/Risk/Improvement/Execution), stoplight indicators, priority actions, critical bottlenecks
2. **Workflow Engine** — Create/manage workflows, break into stages, track movement, detect bottlenecks, health recalculation
3. **Stoplight Scoring** — Red/Yellow/Green system at stage, workflow, and global levels
4. **Asset & Warranty Tracking** — Asset registry with warranty lifecycle, health scores, maintenance schedules
5. **Alert Engine** — Automated 6-rule evaluator (critical items, overdue, aging, bottleneck, health score drops, unassigned high-priority) with deduplication via ruleKey, lifecycle management (active → acknowledged → resolved), category/level filters, per-workflow alert badges
6. **Analytics & Trends** — Score trend charts, workflow performance tables
7. **Document Engine** — Link documents/evidence to workflows, stages, and assets

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

## API Endpoints

| Module | Routes |
|---|---|
| Dashboard | `GET /api/dashboard/summary`, `/bottlenecks`, `/actions` |
| Workflows | `GET/POST /api/workflows`, `GET/PUT/DELETE /api/workflows/:id`, `GET /api/workflows/:id/health` |
| Stages | `GET/POST /api/workflows/:id/stages`, `PUT/DELETE /api/workflows/:id/stages/:stageId` |
| Workflow Items | `GET/POST /api/workflows/:id/items`, `GET/PUT/DELETE /api/workflows/:id/items/:itemId` |
| Item Movement | `POST /api/workflows/:id/items/:itemId/move`, `GET /api/workflows/:id/items/:itemId/history` |
| Bottleneck | `GET /api/workflows/:id/bottleneck` |
| Assets | `GET/POST /api/assets`, `GET/PUT/DELETE /api/assets/:id`, `GET /api/assets/warranties` |
| Alerts | `GET /api/alerts` (with filters: level/category/status/isActive/workflowId), `GET /api/alerts/summary`, `POST /api/alerts/evaluate`, `PATCH /api/alerts/:id/read`, `PATCH /api/alerts/:id/acknowledge`, `PATCH /api/alerts/:id/resolve` |
| Documents | `GET/POST /api/documents` |
| Analytics | `GET /api/analytics/trends`, `/workflow-performance` |

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
