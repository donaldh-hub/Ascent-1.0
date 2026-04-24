# Overview

Ascent 1.0 is a continuous improvement operational intelligence platform designed as an "air traffic control tower" for teams managing workflows, assets, and operational health. It aims to provide comprehensive insights and tools for optimizing operational efficiency.

**Key Capabilities:**

-   **Control Tower Dashboard:** A central hub for operational intelligence. Two views are shipped: the original `/` overview (Flow / Risk / Execution / Improvement) and the new 1.12.5 `/control-tower` route — five top-level tiles (Operational Health master, Work Order Performance, Turn Performance, PM Performance, Asset Performance) with inline expandable drill panels (multiple open at once) and a Priority Actions panel below, all wired to live API data. PM is derived from `assets.maintenance_schedule` coverage until a dedicated PM source is connected.
-   **Workflow Engine:** Facilitates the creation and management of multi-stage workflows, tracking progress, detecting bottlenecks, and recalculating health scores dynamically.
-   **Operational Health Scoring:** Implements a Red/Yellow/Green stoplight system for immediate visual feedback on operational health at stage, workflow, and global levels.
-   **Asset & Warranty Management:** Provides a registry for assets, tracks warranty lifecycles, calculates health scores, and schedules maintenance.
-   **Alert Engine:** Automatically evaluates operational conditions against predefined rules to generate, deduplicate, and manage alerts, ensuring timely response to critical issues.
-   **Analytics & Trends:** Offers tools for analyzing performance trends and workflow effectiveness.
-   **Document Engine:** Enables linking and managing documents and evidence directly within workflows, stages, and assets.
-   **Assignment & Impact Engines:** Manages work order ingestion, intelligent assignment, bottleneck detection, and calculates operational impact and priorities.
-   **Turn Matrix Engine:** Provides detailed intelligence on operational "turns" (e.g., make-ready processes), including completion rates, bottleneck aggregation, and integration into overall operational health scoring.

# User Preferences

I prefer iterative development, with a focus on delivering core features first and then refining them. I appreciate clear and concise communication, avoiding overly technical jargon where simpler language suffices. I expect the agent to ask for clarification or approval before making significant architectural changes or implementing complex features.

# System Architecture

The project utilizes a pnpm workspace monorepo structure with TypeScript.

**Monorepo Structure:**

-   `artifacts/`: Contains the main applications: `api-server` (Express API) and `ascent` (React+Vite frontend).
-   `lib/`: Houses shared libraries including `api-spec` (OpenAPI and Orval codegen), `api-client-react` (generated React Query hooks), `api-zod` (generated Zod schemas), and `db` (Drizzle ORM and DB connection).
-   `scripts/`: Holds utility scripts, such as database seeding.

**Technology Stack:**

-   **Monorepo Tool:** pnpm workspaces
-   **Language:** TypeScript 5.9
-   **Package Manager:** pnpm
-   **Runtime:** Node.js 24
-   **API Framework:** Express 5
-   **Database:** PostgreSQL with Drizzle ORM
-   **Validation:** Zod (`zod/v4`), `drizzle-zod`
-   **API Codegen:** Orval (from OpenAPI specification)
-   **Build Tool:** esbuild (CJS bundle)
-   **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion

**UI/UX Decisions:**

-   **Design System:** shadcn/ui and Tailwind CSS for a consistent and modern aesthetic.
-   **Data Visualization:** Recharts for analytical graphs and charts.
-   **Animations:** framer-motion for smooth UI transitions.
-   **Dashboards:** Feature rich dashboards like the Control Tower dashboard, Asset Health Pulse, and specific property/unit detail views.
-   **Interaction:** Extensive use of drill-down sheets and clickable operational signals for detailed context.

**Core Feature Implementations:**

-   **Scoring Engine:** Centralized logic in `artifacts/api-server/src/engine/scoring.ts` for calculating Flow, Risk, Improvement, Execution, and Operational Health Scores. It uses a loader (`loader.ts`) to assemble data from the database without direct DB access in calculation functions. Stoplight thresholds are consistently applied: ≥75 (Green), 50-74 (Yellow), <50 (Red).
-   **Alert Engine:** Implemented in `artifacts/api-server/src/engine/alerts.ts`, featuring six rule evaluators (critical items, overdue, aging, bottleneck, health, unassigned critical). Alerts are deduplicated using a stable `ruleKey` and follow an `active` → `acknowledged` → `resolved` lifecycle.
-   **Document Engine:** Utilizes Google Cloud Storage for document storage. A two-step upload process involves requesting a presigned URL from the API (`POST /api/documents/upload-url`), direct browser upload to GCS, and then registration of the document via `POST /api/documents`.
-   **Reaction Layer (Drill-Downs):** A robust system where major operational signals are clickable, opening a `DrillDownSheet` panel. The backend (`GET /api/drill`) provides structured `DrillResponse` data for various signal types.
-   **Financial Intelligence Engine:** Integrates replacement cost data by mapping asset types to benchmark costs in `artifacts/api-server/src/lib/cost-lookup.ts`. This data is reflected in drill-down responses, portfolio summaries, and property/unit detail views, showing dollar exposure for warranties and assets.
-   **Turn Matrix Engine:** Manages `turns` data, including weighted completion, blocked turn detection, and rework logic. It integrates deeply into the Control Tower, providing turn-derived scores and signals for Flow, Risk, Execution, and Improvement, overriding workflow-based scores where turn data exists.
-   **Narrative Intelligence Layer (Build 1.11):** Structured WHAT/WHY/IMPACT/ACTION narratives computed client-side from turnStats for all 4 dimension reveal panels and the Primary Turn Bottleneck panel. Logic lives in `artifacts/ascent/src/lib/turn-narratives.ts` (5 generators). The `NarrativeBlock` component (`artifacts/ascent/src/components/narrative-block.tsx`) renders narratives with color-coded accent borders and clickable ACTION rows that open the DrillDownSheet with relevant turn records. Property-detail reveal panels also emit narratives when property-scoped turn data is available. Narratives degrade gracefully to null when no turn data exists.
-   **Dual-Mode Import Governance Layer (Build 8 — Phase 1):** Every CSV row ingested via `POST /api/work-orders/import` is now classified into one of three resolution states: `fully_resolved` (property + unit matched → all analytics + rollups), `partially_resolved` (property matched, unit pending → property rollup only), or `unresolved` (no confident property match → review queue only, excluded from dashboard truth). Governed by `artifacts/api-server/src/services/governance-service.ts` which exposes `classifyResolutionState()`, `computeGovernanceFields()`, `recordImportRun()`, and `getImportSummary()`. Import mode (`flexible` | `strict`) is selectable per-batch; strict mode additionally flags fuzzy property matches as partial. Key rule: `created` confidence (auto-created properties for unknowns) → `unresolved`. All 11 governance columns added to `work_orders` (`import_mode`, `resolution_status`, `assignment_confidence`, `property_match_status`, `unit_match_status`, `source_file_name`, `source_row_index`, `governance_notes`, `excluded_from_strict_wiring`, `available_for_property_rollup`, `available_for_unit_rollup`). `import_runs` table tracks each batch. Frontend: `CSVUploadPanel` has a mode toggle (Flexible/Strict), `ResolutionBadge` component shows resolution state in WO list rows, Governance Summary results step shows 3 resolution cards + operational alert banners. API spec updated with `WorkOrder`, `GovernanceSummary`, `WorkOrderImportResult`, `ImportRun`, `ImportWorkOrdersBody` schemas + `/work-orders`, `/work-orders/import`, `/work-orders/imports/{batchId}` paths. New GET endpoint `GET /api/work-orders/imports/:batchId` returns live governance summary for any past batch.
-   **Reporting + Analytics Backbone (Build 7 — Master Spine):** Centralized reporting service in `artifacts/api-server/src/services/reporting-service.ts` that reads from all existing engines (scoring, intelligence, work orders, turns, documents, assignments). Defines `ReportFilter`, `ReportOutput`, `ReportInsight`, and `ReportSection` as the shared report data contract for all future sub-builds. Analysis blocks: `buildBottleneckAnalysis()`, `buildTimingAnalysis()`, `buildRiskAnalysis()`, `buildEvidenceAnalysis()`, `buildAssignmentAnalysis()`. Report builders: `buildOperationalReport()`, `buildWorkflowReport()`, `buildDocumentReport()`, `buildAssignmentReport()`. Narrative insight generators produce plain-language insights grounded in real metric counts. `REPORT_REGISTRY` defines all 4 report types (operational, workflow-summary, document-coverage, assignment-coverage). API routes in `artifacts/api-server/src/routes/reports.ts`: `GET /api/reports`, `GET /api/reports/operational`, `GET /api/reports/workflow-summary`, `GET /api/reports/document-coverage`, `GET /api/reports/assignment-coverage`. Honest about data limits — no fabricated trends. Analytics page (`artifacts/ascent/src/pages/analytics.tsx`) upgraded to full reporting home with 4 tabs, date range filter, metric grids, bottleneck/timing analysis sections, and sorted insight lists with severity badges.
-   **Control Tower Dashboard Restructure (Build 1.11.5):** Major layout overhaul of `dashboard.tsx`. Row 1 compressed to 3-column grid (OHS gauge col-3 | 4 dim cards col-5 | Priority Actions col-4). Priority Actions panel (`PriorityActionsPanel`) shows exactly 3 fixed items — WORK ORDER (from SLA data), TURN (from blocked turnStats), PM (from aging WO count) — each clickable to drill-down. Rows 3/4/5a replaced with a 3-column Operational Focus Layer (Stage Aging & Blocking | Primary Turn Bottleneck | Operational Queue). `OperationalPrioritiesPanel` shows top 8 intel.actions ranked by urgency. `StageDistributionChart` completely removed. Navigation restructured to 8 items: Overview, Property, Work Orders, Turns, Assignments, Documents, Assets, Analytics (Workflows and Alerts removed).
-   **Governance / Architecture Lock (Build 1.12.6):** Control Tower is now the single source of truth for every operational signal. **Shared selector layer** in `artifacts/api-server/src/services/operational-selectors.ts` exposes Drizzle WHERE-builders + JS predicates for every WO / Turn / Asset signal (AGING_DAYS=7, BLOCK_THRESHOLD_DAYS=7, WARRANTY_EXPIRING_DAYS=90), plus `WORK_ORDER_SIGNAL_WHERE` / `TURN_SIGNAL_WHERE` / `ASSET_SIGNAL_WHERE` registries and `isWorkOrderSignal` / `isTurnSignal` / `isAssetSignal` type guards. Client mirror in `artifacts/ascent/src/lib/operational-predicates.ts` (mirrors the server WHERE clauses for client-side asset filtering since `useListAssets` is generated). All drill endpoints (`drill.ts`) and `getWorkOrderStats` consume the shared layer — no inline recompute. **Routing:** sidebar no longer shows Overview, `/control-tower` is the default landing (`ControlTowerRedirect` mounted at `/`), `/overview` retained for admin access, brand logo points to `/control-tower`. **Detail-page filter contract:** `/api/work-orders` and `/api/turns` accept `?signal=<sig>` and apply the shared WHERE; `/assets` filters client-side via the shared predicate. Detail pages show a "Filtered by Control Tower signal" banner with clear-filter link. Drill rows for WO and Turn signals navigate to `/work-orders?signal=…` and `/turns?signal=…` so the visible list matches the drill exactly. Asset drill rows intentionally deep-link to `/units/<id>` for unit-level context (count symmetry preserved at the drill badge). **Locked count invariants** (verified end-to-end): SLA Violations = 76, Blocked Turns = 30, Expired Warranties = 102 — drill total = list endpoint length = banner count. The OHS tile is documented as a TEMPORARY COMPOSITE (no drill records of its own; it averages the four child tiles).

# External Dependencies

-   **Google Cloud Storage (GCS):** Used for object storage, specifically for the Document Engine.
-   **PostgreSQL:** The primary relational database for storing all application data.
-   **Drizzle ORM:** Used for programmatic interaction with the PostgreSQL database.
-   **Orval:** An OpenAPI code generator used to create API client hooks and Zod schemas.