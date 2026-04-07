# Overview

Ascent 1.0 is a continuous improvement operational intelligence platform designed as an "air traffic control tower" for teams managing workflows, assets, and operational health. It aims to provide comprehensive insights and tools for optimizing operational efficiency.

**Key Capabilities:**

-   **Control Tower Dashboard:** A central hub for operational intelligence, displaying overall health, key performance indicators across four dimensions (Flow, Risk, Execution, Improvement), trend signals, priority actions, primary bottlenecks, and workflow distribution.
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
-   **Control Tower Dashboard Restructure (Build 1.11.5):** Major layout overhaul of `dashboard.tsx`. Row 1 compressed to 3-column grid (OHS gauge col-3 | 4 dim cards col-5 | Priority Actions col-4). Priority Actions panel (`PriorityActionsPanel`) shows exactly 3 fixed items — WORK ORDER (from SLA data), TURN (from blocked turnStats), PM (from aging WO count) — each clickable to drill-down. Rows 3/4/5a replaced with a 3-column Operational Focus Layer (Stage Aging & Blocking | Primary Turn Bottleneck | Operational Queue). `OperationalPrioritiesPanel` shows top 8 intel.actions ranked by urgency. `StageDistributionChart` completely removed. Navigation restructured to 8 items: Overview, Property, Work Orders, Turns, Assignments, Documents, Assets, Analytics (Workflows and Alerts removed).

# External Dependencies

-   **Google Cloud Storage (GCS):** Used for object storage, specifically for the Document Engine.
-   **PostgreSQL:** The primary relational database for storing all application data.
-   **Drizzle ORM:** Used for programmatic interaction with the PostgreSQL database.
-   **Orval:** An OpenAPI code generator used to create API client hooks and Zod schemas.