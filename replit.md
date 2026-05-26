# Overview

Ascent 1.0 is an operational intelligence platform designed to act as an "air traffic control tower" for teams managing workflows, assets, and operational health. Its primary purpose is to provide comprehensive insights and tools to optimize operational efficiency and decision-making. Key capabilities include a central dashboard for operational intelligence, a workflow engine, operational health scoring, asset and warranty management, an alert engine, analytics, a document engine, and intelligent assignment and impact analysis. It also features a Turn Matrix Engine for detailed operational "turn" intelligence.

# User Preferences

I prefer iterative development, with a focus on delivering core features first and then refining them. I appreciate clear and concise communication, avoiding overly technical jargon where simpler language suffices. I expect the agent to ask for clarification or approval before making significant architectural changes or implementing complex features.

# System Architecture

The project is structured as a pnpm workspace monorepo using TypeScript. The architecture separates concerns into `artifacts/` (main applications like `api-server` and `ascent` frontend), `lib/` (shared libraries for API specifications, client generation, Zod schemas, and database interactions), and `scripts/` (utility scripts).

**Technology Stack:**

-   **Monorepo:** pnpm workspaces
-   **Language:** TypeScript
-   **Runtime:** Node.js
-   **API:** Express 5
-   **Database:** PostgreSQL with Drizzle ORM
-   **Validation:** Zod
-   **API Codegen:** Orval (from OpenAPI)
-   **Frontend:** React, Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion

**UI/UX Decisions:**

The frontend leverages shadcn/ui and Tailwind CSS for a modern, consistent design, with Recharts for data visualization and framer-motion for UI animations. The design emphasizes feature-rich dashboards (e.g., Control Tower, Asset Health Pulse), extensive use of drill-down sheets, and clickable operational signals for detailed context.

**Core Feature Implementations:**

-   **Scoring Engine:** Calculates Flow, Risk, Improvement, Execution, and Operational Health Scores with a Red/Yellow/Green stoplight system (≥75 Green, 50-74 Yellow, <50 Red).
-   **Alert Engine:** Automatically evaluates operational conditions against rules to generate, deduplicate, and manage alerts through an `active` → `acknowledged` → `resolved` lifecycle.
-   **Document Engine:** Integrates with Google Cloud Storage for document management, utilizing presigned URLs for secure uploads.
-   **Reaction Layer (Drill-Downs):** Provides detailed context for operational signals via `DrillDownSheet` panels, backed by structured API responses.
-   **Financial Intelligence Engine:** Maps asset types to benchmark costs to show financial exposure in various views.
-   **Turn Matrix Engine:** Manages `turns` data, including completion, bottleneck detection, and rework logic, integrating these insights into overall operational health scoring.
-   **Narrative Intelligence Layer:** Generates structured WHAT/WHY/IMPACT/ACTION narratives from turn statistics for various panels.
-   **Import Governance Layer:** Classifies imported CSV rows (e.g., work orders) into resolution states (`fully_resolved`, `partially_resolved`, `unresolved`) based on property and unit matching, ensuring data quality for analytics.
-   **Reporting + Analytics Backbone:** A centralized reporting service that consolidates data from various engines to generate comprehensive operational, workflow, document, and assignment reports with narrative insights.
-   **Control Tower Dashboard:** A redesigned central hub that is the single source of truth for operational signals, featuring a streamlined layout, priority actions, and an operational focus layer.
-   **Governance / Architecture Lock:** Establishes a shared selector layer for consistent signal logic across the API and client, ensuring signal integrity and routing.
-   **System Enforcement Layer:** Adds runtime and static enforcement mechanisms, including service contracts, a confidence filter for reportable data, and a symmetry validator to ensure consistency between SQL selectors and JavaScript predicates for critical operational signals.

# Build Promotion History

## Build 7.4 — Visuals + Dashboard Reporting Layer — PROMOTED (baseline for Build 7.5)

- Build 7.4 Visuals + Dashboard Reporting Layer: **PASS**
- Reports visual layer rendered: **PASS**
- Active reporting mode visible on Reports page: **PASS**
- Work-order-measured turn progress language preserved: **PASS**
- Turn-related work order language preserved: **PASS**
- Supporting-record links visible: **PASS**
- Readiness / data-quality states visible: **PASS**
- PM, asset, evidence, assignment, and wired-source reporting sections visible: **PASS**
- Agent-reported auditor state: **26 pass / 0 partial / 0 fail**
- Build 7.4 safe to ship

This state is the locked baseline for Build 7.5. Do not rerun Build 7.4, duplicate the completed visual reporting layer, or alter the active reporting mode / turn-vs-work-order gating logic without an explicit Build 7.5+ task that supersedes it.

# External Dependencies

-   **Google Cloud Storage (GCS):** For document storage within the Document Engine.
-   **PostgreSQL:** The primary database for all application data.
-   **Drizzle ORM:** Used for database interaction.
-   **Orval:** Utilized for OpenAPI code generation.