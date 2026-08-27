# Ingestion connection ladder: upload -> email -> file automation -> API (parked)

Status: parked, not started as a whole — but built on top of real, partially-
existing infrastructure (see "What already exists" below). This is a
strategy document the user brought in fully formed; this note preserves it
and annotates it against the actual codebase.

## The core idea

Upload is the first connection method, not the only one. Build the
ingestion architecture so upload, email, and future direct APIs all feed
the *same* intelligence pipeline — never a second scoring/classification
system per delivery channel. Quoting the user directly: "Upload first does
not make Ascent less advanced. It makes Ascent available before the
integrations are ready."

## The four-phase connection ladder

1. **Manual upload** (fastest to real customers, no one's permission
   needed). Customer exports a report from Yardi, RealPage/Voyager,
   AppFolio, Entrata, Buildium, or a generic Excel/CSV export, and uploads
   it. Ascent identifies the source format, maps columns, normalizes
   properties/units/dates/statuses, classifies unmatched data honestly
   (not silently), and produces Control Tower + supporting intelligence.
2. **Inbound email ingestion**. Customer forwards or schedules a report to
   an Ascent-generated address (e.g. `reports+customername@ascent1.com`).
   Ascent confirms sender/account, identifies the attachment, validates
   report type + period, prevents duplicate ingestion, runs it through the
   *same* upload engine, and notifies the customer when done. Valuable
   because many property-management systems can already auto-schedule
   emailed reports — no API needed for recurring intelligence.
3. **Secure file automation**. For larger customers: Ascent watches a
   secure cloud folder, SFTP location, or customer-controlled export
   location, and processes new reports automatically on arrival.
4. **Direct API integrations**. Technically straightforward; the real
   friction is business/process, not code: vendor approval, API
   credentials, partner certification, customer authorization, differing
   data structures, rate limits, webhooks/sync, tracking updated/deleted
   records, and strict tenant isolation (one customer must never see
   another's data — this last one is already true today, see PR #4's
   `user_site_access` model, though that's user-to-site, not
   customer-to-customer isolation within shared infrastructure, which is
   a distinct concern for this phase). Competitors advertise *certified*
   integrations with Yardi/RealPage/Entrata/AppFolio specifically because
   the certification process is often the actual bottleneck, not the
   integration code. Design Ascent to be API-ready now; don't make
   partnerships a launch dependency.

## The architectural rule (non-negotiable per the user)

Every connection method must terminate in one shared record contract —
normalize, classify, score, and report the same way regardless of whether
data arrived by upload, email, or API. Never build a second scoring method
per delivery channel; only the delivery mechanism should differ.

## What already exists — this is not starting from zero

- **`reporting-ingestion-service.ts`** already is a "shared ingestion
  layer" façade: it pulls every wired source through
  `report-source-normalizer.ts`, applies eligibility classification, and
  produces both per-source readiness and a global summary. This is the
  shared pipeline the architecture calls for, for the *entity-type* axis
  (work orders vs. turns vs. assets vs. documents, etc.).
- **`NormalizedReportingRecord`** (`reporting-record-contract.ts`) is
  already the single shared record shape everything downstream (Control
  Tower, evidence analysis, priority ranking, trend analysis, narrative
  insights) consumes — exactly the "shared source of truth" the
  user's diagram calls for.
- **`REPORTING_SOURCE_REGISTRY`** (`reporting-source-registry.ts`) is
  already a declarative, single-place registry of source types with
  required/optional fields, confidence requirements, and report-family
  wiring — "add a new source by adding an entry here, never by
  hand-rolling definitions elsewhere" is already the stated house rule.
- **`COLUMN_ALIASES`** (`work-order-service.ts`) already gives column-name
  flexibility today (e.g. "vendor" matches "vendor_name", "contractor",
  "service_vendor") — this is the seed of vendor-format tolerance, just
  not yet organized into named per-vendor profiles, and it doesn't yet
  handle vendor-specific quirks beyond column renaming (date formats,
  status vocabularies, priority scales likely differ by vendor too).

## What's genuinely new, not an extension of existing code

- **Named, documented per-vendor mapping profiles** (Yardi, RealPage,
  AppFolio, Entrata, Buildium, generic CSV/Excel) — each stating which
  column is property/unit/WO-number, which dates mean
  submitted/assigned/completed, how priority/status are expressed, what's
  typically missing, and what Ascent can/cannot conclude from that source.
  This extends `COLUMN_ALIASES` into a structured, per-vendor concept
  rather than one flat global alias table — and needs source-format
  *detection*, which doesn't exist today (today's uploader assumes one
  generic shape with aliased columns, not "which of N known vendor
  formats is this file").
- **Inbound email ingestion** — no receiving infrastructure exists at all
  today (confirmed: no SMTP/webhook-receiving route anywhere in the repo).
  Needs: a receiving endpoint/webhook, sender-to-account verification,
  attachment extraction, report-type + period validation, and duplicate-
  ingestion prevention, before handing off to the existing upload engine.
- **Secure file automation** (folder/SFTP watching) — new infrastructure,
  no current equivalent.
- **Direct API integrations** — new per-vendor work, gated more by
  business/certification process than code, per the user's own framing.

## Email is two separate features — keep them separate

- **Outbound** (Ascent sends): reports, flagged issues, recommendations,
  shared findings, notifications, Jordan summaries. A stub convention
  already exists (`email-service.ts`'s `sendReportEmail`,
  `sendMagicLinkEmail`) — this is additive to something already there,
  and is exactly what the flagged-issues feature (also parked, see
  `flagged-issues-feature.md`) needs for its notification step.
- **Inbound** (Ascent receives): scheduled work-order/turn/PM/asset report
  emails. Different security model entirely (verifying an external sender
  is who they claim to be, on behalf of a real account) — do not conflate
  with outbound just because both are "email."

## Go-to-market sequencing (the user's framing, worth preserving verbatim)

1. "Upload your existing reports. Ascent turns them into operational
   intelligence."
2. "Stop uploading manually. Have your system email the report directly
   to Ascent."
3. "Connect your system directly for continuously updated intelligence."

This creates a growth path without making API partnerships (the slowest,
least code-dependent piece) a launch dependency.

## Next step when picked up

Don't design the vendor mapping profiles or inbound email in isolation —
read `report-source-normalizer.ts`, `reporting-source-registry.ts`, and
`work-order-service.ts`'s `COLUMN_ALIASES` first, since the goal is to
extend that existing shared pipeline, not build a parallel one. The
Control Tower / Governance Lock notes in replit.md (single source of
truth for signal definitions) apply here too: whatever normalizes vendor
data must still produce the exact same `NormalizedReportingRecord` shape
everything downstream already depends on.
