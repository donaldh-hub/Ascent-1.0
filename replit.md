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

**Current state (superseding the stale "baseline for Build 7.6" note below): Build 12.2 is PROMOTED and tagged Ascent 1.0 Launch Ready. A further, unnumbered Post-Launch layer (Jordan AI coach, subscriptions, landing page, tenancy) has since been built on top of it — see the two sections above the 7.5/7.4 entries for the full record.** This file had not been updated between Build 7.5 and Build 12.2; the entries below fill that gap from commit history.

## Post-Launch — Jordan Coach, Subscriptions, Landing Page (unnumbered, built after Build 12.2)

- Jordan: Subscriber preference store + convergence scoring engine
- Jordan: Weekly summary engine + updated coach routes
- Jordan: Activation flow + weekly summary panel + coach page
- Jordan: Auto-trigger activation modal after first data upload
- Jordan chat bubble — replaces full-screen activation modal
- Account status service + subscription routes
- Public landing page + onboarding page shell
- Subscribe wall + app shell rewiring for landing/onboarding/engine flow
- Minimal tenancy: anonymous session + reports schema
- Gate uploads beyond the first and report downloads behind subscription
- View-only share link for reports
- Stubbed email-a-coworker send
- Landing page demo dashboard, LLM-backed coach, and pricing page (current HEAD as of this update)

This layer is not covered by an audit gate the way Builds 7–12 are. Treat it as active/unlocked until a Build 13 promotion + audit gate is run against it.

## Build 12.2 — Final Launch Readiness Audit Gate — PROMOTED (Ascent 1.0 Launch Ready)

Final launch readiness audit gate, closing out the Build 12 series. Marks the point the codebase was declared launch-ready, before the Post-Launch (Jordan/subscriptions/landing page) layer above was added.

## Build 12.1 — Launch Readiness Checklist Service + Panel — PROMOTED

## Build 12.0 — System Health + Observability Panel — PROMOTED

## Build 11.3 — Build 11 Audit Gate + reports.tsx wired — PROMOTED

## Build 11.2 — Data Quality Guardrails + Panel — PROMOTED

## Build 11.1 — Notification Bell + Active Notifications Service — PROMOTED

## Build 11.0 — Operations Coach Service + Route + Panel — PROMOTED

## Build 10 — Self-service upload, demo dataset, trial readiness, customer audit gate — PROMOTED

- Build 10.0: CSV upload ingestion service + route + drag-drop upload panel + /upload page
- Build 10.1: Demo dataset loader (150 WOs across 2 properties) + frontend panel
- Build 10.2: Trial readiness engine with Operations Coach unlock scoring
- Build 10.3: Customer readiness audit gate in build-auditor route + frontend gate component

## Build 9 — Asset Registry, Warranty Intelligence, Asset Performance — PROMOTED

- Build 9.0: Asset Registry Service + Route + Panel
- Build 9.1: Warranty Intelligence Service + Route + Panel
- Build 9.2: Asset Performance Service + Route + Panel
- Build 9.3: Asset/Warranty Audit Gate + reports.tsx wired

## Build 8.0–8.3 — Impact Recalculation Engine — PROMOTED

- Build 8.0: Impact Recalculation Engine — calculateImpactSnapshot() projects staleness, recent changes, completion impact, missing evidence impact
- Build 8.1: Priority Action Recalculation Layer — rankPriorityActions()
- Build 8.2: Trend + Pattern Intelligence Layer — analyzeTrends()
- Build 8.3: Impact Recalculation Audit Gate (GET /api/build-auditor/8-3)

## Build 7.9 — Reporting Completion Audit + Promotion Gate — PROMOTED

GET /api/build-auditor/7-9 checks all 6 reporting categories (work orders, turns, PM, assets, evidence, assignments) for analysis outputs and confidence states.

## Build 7.8 — Report Export + Snapshot Layer — PROMOTED

New GET /api/reports/snapshot endpoint returning full reporting state as a JSON snapshot.

## Build 7.7 — Assignment + Data Quality Reporting Layer — PROMOTED

AssignmentDataQualitySection component: resolution state summary, review queue CTA, drill-down sheet for records needing resolution.

## Build 7.6 — Evidence + Documentation Reporting Layer — PROMOTED

New evidence-context-analyzer.ts service: breaks coverage down by property, unit, and entity type; produces missing-doc report.

## Build 7.5 — PM Data Mapping Layer — PROMOTED (superseded as baseline by Build 12.2 above; outputs still locked)

- PM Mapping Readiness section renders on /reports: **PASS**
- /reports renders: **PASS**
- Build badge shows `Build 7.1 + 7.2 + 7.3 + 7.5`: **PASS**
- PM readiness shows 10 rows (was 9 in 7.4): **PASS**
- PM counts are honest in low-data state (0/0/0/0, confidenceState=insufficient_data): **PASS**
- No fake PM performance appears: **PASS**
- Supporting-record trace returns honest empty result when no matching records exist: **PASS**
- PM language stays separate from work order, turn, and asset language: **PASS**
- Control Tower still renders: **PASS**
- 7.4 baseline logic did not regress (summary tiles unchanged at 2,733 / 2,654 / 78 / 1): **PASS**
- No fake "Completed" bucket appears (claimed-completed-without-date demoted to Unknown + conflicting-dates warning): **PASS**
- All 12 visual-proof checks passed (Playwright + screenshots)
- Agent-reported auditor state: **28 pass / 0 partial / 0 fail / 2 manual** (both `build.7_5.*` checks pass)
- Build 7.5 safe to ship

Build 7.5's PM mapping logic (alias detection, status derivation, confidence derivation, derived-view exclusion from the global ingestion summary) and PM-only vocabulary remain locked outputs carried forward through every later build — do not alter them without an explicit task that supersedes this note. Build 7.4's locked outputs (active reporting mode, turn-vs-work-order gating, 7.1–7.3 visual layer) remain locked under 7.5. Build 12.2 is the current promoted baseline; see above.

## Build 7.4 — Visuals + Dashboard Reporting Layer — PROMOTED (superseded as baseline by Build 7.5; outputs still locked)

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

Build 7.4 outputs remain locked under the Build 7.5 baseline. Do not rerun Build 7.4, duplicate the completed visual reporting layer, or alter the active reporting mode / turn-vs-work-order gating logic without an explicit Build 7.6+ task that supersedes them.

# External Dependencies

-   **Google Cloud Storage (GCS):** For document storage within the Document Engine.
-   **PostgreSQL:** The primary database for all application data.
-   **Drizzle ORM:** Used for database interaction.
-   **Orval:** Utilized for OpenAPI code generation.