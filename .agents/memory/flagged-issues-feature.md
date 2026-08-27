# Flagged Issues — addressable, linkable, commentable signals (parked feature)

Status: parked, not started. Came out of the multi-user access control work
(PR #4, branch `refactor/dedupe-engine-marketing`) — the recipient-picker
half of this feature depends on `user_site_access`, so build this after
that PR merges.

## The ask

A regional/area manager (example given: Ryan) looks at Control Tower and
sees a bottleneck with a system-generated recommendation (the existing
Narrative Intelligence Layer / priority-action-ranker output). He wants to
loop in specific people (example: Eric, Donald) by email — not a link back
to "go look at the dashboard," but an email that:

- Names the exact issue and the exact recommendation, inline.
- Contains a link that takes the recipient to the *exact same information*
  Ryan saw — no hunting for it.
- Lets the recipient respond, visibly, on that same issue — a real
  discussion thread, not a dead-end email reply.

User's own words: "I need everybody to have the ability to hit a link, see
the exact same information, and be able to respond to it."

## Why this isn't a small add-on

Signals today (blocked turns, aging work orders, SLA violations, etc. — see
`operational-selectors.ts` and `priority-action-ranker.ts`) are computed
live on every request. There is no stored, addressable "thing" with its own
ID that a URL could point to, and nothing to attach a comment thread to.
This feature needs:

1. **A persisted "flagged issue" record** — a snapshot of a signal +
   recommendation at the moment someone flags it (site, signal type, the
   narrative text, who raised it, when). Needs its own id/URL.
2. **A comment/discussion thread** on that record.
3. **Access-gated deep links** — the link must require login (the
   magic-link auth from PR #4) and check the recipient actually has
   `user_site_access` to that issue's site. Not an open public URL to
   internal property data.
4. **A "smart" recipient picker** — populated from `user_site_access` for
   that site (who's assigned to it, plus whoever's broader access
   includes it), not a free-text email field.
5. **The notification email itself** — reuses the existing stubbed-email
   convention (`email-service.ts`), sent when a flagged issue is created
   with recipients attached.

## Suggested sequencing when this gets picked up

- New `flagged_issues` + `flagged_issue_comments` tables.
- A "Flag this / Send to..." action wired into Control Tower / Turns /
  Priority Actions, using the already-existing narrative text as the
  snapshot content.
- A detail page (`/issues/:id`) gated by `requireUser` + site-access check,
  with the comment thread.
- Recipient picker backed by `getAccessibleSites`/an inverse lookup
  ("who else has access to this site") in `access-service.ts`.
- Email send on creation, using `sendMagicLinkEmail`'s pattern (stubbed,
  logs + returns the link, since no real provider is configured yet).
