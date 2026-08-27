# Jordan as a real interactive conversation (parked feature)

Status: parked, not started. Flagged the same night as the flagged-issues
feature (PR #4 work) — user considers this an important differentiator.

## Persona (added later the same night — read CLAUDE.md's "Positioning
boundary" section first, this is now locked framing)

Jordan is "the coach outside the boxing ring" — not in the ring fighting,
on the outside seeing what the fighter can't see, giving them a different
vantage point. Concretely: Jordan observes and explains, it never directs
execution or acts like a dispatcher/ops system.

Jordan's precise role, in the user's own words: reads the Control Tower,
explains the score, points to supporting records, identifies blind spots,
answers follow-up questions, helps leadership interpret patterns, compares
one reporting period with another, and measures whether previous decisions
produced improvement. Jordan is a "corner coach," not a dispatcher or
maintenance supervisor.

**The concrete good/bad example — use this as the literal tone reference,
not just a paraphrase:**

Jordan does NOT say:
> "I completed that work order."

Jordan says:
> "This unit has generated four plumbing-related work orders in 60 days.
> Three were closed without a documented cause. Before treating the
> latest request as isolated, review the repair history and determine
> whether the team is addressing symptoms instead of the underlying
> failure."

The difference is the whole point: the first is task management (out of
scope — see CLAUDE.md's positioning boundary). The second is coaching
through intelligence — evidence, a pattern, and a pointed question back
to the human, never an action taken or claimed on Jordan's behalf. Every
response this feature ever generates should be checked against this
example, not just against the grounding/no-invention rule below.

## The ask

Jordan today (weekly-summary-engine.ts, coach-preference-service.ts, the
JordanChatBubble UI) is template-based: hardcoded recommendation strings
built from simple thresholds (e.g. "Chase down the ${aging} work orders
that have been open more than 14 days..."), not an actual conversation.
There is no LLM in the loop anywhere in the authenticated engine today.

User wants Jordan to be genuinely interactive — a real back-and-forth
conversation with an AI that has read the user's actual data and can
reason about it live, "the same way that we're conversing here." Not a
scripted chatbot with canned branches.

## Why this is a legitimate, different use of an LLM

Earlier the same night, `@anthropic-ai/sdk` was removed from this repo
entirely (see the "Remove duplicate marketing/pricing surface" commit) —
but that removal was because the *only* thing using it was a fake public
teaser coach on the removed `/landing` page, answering questions against a
hardcoded mock dataset (Riverside Commons) for anonymous website visitors.

A real interactive Jordan is a different thing: it would run for logged-in
users, reasoning over their own actual work orders/turns/assets — scoped by
the site-access model from this same PR (`user_site_access`,
`req.accessibleSiteIds`) so Jordan never surfaces data outside what a user
is allowed to see. Bringing an LLM dependency back in for this is
warranted; reviving the old landing-coach-service.ts pattern wholesale is
not — this needs its own design, not a resurrection of the deleted file.

## Hard constraint: retrieval-grounded, not generative (this is the core design driver)

User's own words: "Nothing is being generated. Nothing is being
manufactured. Nothing is being invented. A question is being asked. Jordan
is digging into the system to see what needs to be seen, and he's bringing
back information and follow-up questions."

This rules out "stuff some data into a prompt and let the model free-write
an answer." The right architecture is tool-calling / RAG, not prompt
stuffing: Jordan gets a defined set of tools/functions that query the real
system (e.g. "get work orders for site X filtered by status," "get this
asset's warranty status," "get current blocked turns") — mirroring the
signal definitions already centralized in `operational-selectors.ts` so
Jordan's answers use the exact same predicates as the rest of the app, not
a second, drifting definition of "blocked" or "aging." The LLM's job is to:
figure out which tool(s) a question needs, call them, present what actually
came back, and ask a clarifying follow-up when the question is ambiguous
— never fill gaps with invented specifics. Every concrete claim in a
response should be traceable to a real tool call result, not model
free-generation. This is the main design risk if skipped: an LLM given a
vague "answer questions about the data" prompt without hard tool-calling
boundaries will confidently invent plausible-sounding specifics, which is
the opposite of what's wanted here for something managing real maintenance
operations.

## Voice interaction

User asked how far-fetched a microphone/voice-conversation mode is instead
of always typing to Jordan. Answered directly in-session: not far-fetched
at all — it's an additive layer, not a redesign. Speech-to-text on the
input (browser mic capture -> transcription -> same text pipeline as
typed chat) and optionally text-to-speech on the output (Jordan speaks
back) sit on top of the core interactive-Jordan build; they don't change
the tool-calling/grounding architecture above. Sequence this after the
core text-based, grounded conversation works, not before.

## Rough shape (not designed in detail yet)

- A real chat endpoint: user asks a question; a tool-calling LLM decides
  which read-only tool(s) to invoke against the user's own accessible-sites
  data (`req.accessibleSiteIds`), calls them, and composes an answer from
  the actual returned data — not a template lookup, not free-generation.
- Needs conversation state — Jordan should remember what was already asked
  in the session, not treat every message as a cold start.
- Every tool must itself be scoped by `req.accessibleSiteIds` — the
  boundary belongs on the data-fetching tools, not just on what the model
  is told not to say.
- Likely reuses the coach-preferences/coach-weekly-summaries tables for
  personalization context, but the underlying generation moves from
  templates to real tool-grounded LLM calls.
- Needs a decision on which provider/SDK to reintroduce (tool-calling
  support required) and what the tool surface looks like — probably a thin
  wrapper per signal/entity type, reusing `operational-selectors.ts`
  definitions rather than redefining "blocked"/"aging"/etc. a second time.
- Voice input/output (see above) as a follow-on layer once the core
  grounded conversation works.

## Example queries (from the user, use as acceptance tests when built)

- "How many open work orders do we have at [site]?" — a site-scoped count
  by status; maps directly to the work-orders list query already scoped by
  `req.accessibleSiteIds` (PR #4), just needs a "count by status for a
  named site" tool wrapping it.
- "How many turns do we have at Elmwood Terrace, and how many of them are
  close to being completed?" — a site-scoped turn count plus a
  "near-completion" tool built on the same predicates `turn-matrix-service`
  and `operational-selectors.ts` already use (e.g. days-in-stage close to
  typical completion, not blocked/not-rent-ready) — do not invent a new
  "close to completion" definition; derive it from existing turn-status
  logic or ask for a precise definition if one doesn't already exist.
- General pattern: questions are almost always "count/status of [entity]
  at [named site]" — the tool surface should be built around that shape
  first (by-site, by-entity-type, by-status/condition), since that's what
  real usage looks like, not abstract Q&A.
- **Diagnostic/goal-oriented, not just lookup**: "Work Order Performance is
  43/100 — how do we get it to 75 in the next 60 days?" This is a
  materially different, harder capability than the count questions above:
  Jordan needs to know the actual scoring formula (visible in Control
  Tower: open work orders, past-24h SLA, aging >7 days, completion rate),
  find which real records are dragging the score down, and give
  recommendations tied to those specific records — not generic
  "improve your SLA" advice.
  **Important: this capability already substantially exists as
  non-conversational engines** — `impact-recalculation-engine.ts`
  (Build 8.0, `calculateImpactSnapshot`), `priority-action-ranker.ts`
  (Build 8.1, `rankPriorityActions`), and `trend-pattern-analyzer.ts`
  (Build 8.2, `analyzeTrends`) already compute ranked, real-record-backed
  priority actions and trend/bottleneck analysis. Jordan's job for this
  kind of question is to call these as tools and narrate/synthesize their
  actual output conversationally — including handling a "by when" target
  (may need a new tool: given a target score and a timeframe, which subset
  of the already-ranked priority actions would close the gap) — NOT to
  invent a fresh bottleneck-detection or recommendation system. Same
  grounding rule applies: every recommendation must trace to a real
  ranked action from these engines, never a generated-sounding platitude.

## Next step when picked up

Don't jump straight to code — this needs a short design pass first:
the tool surface (what functions Jordan can call and what each returns),
how conversation history is stored, and how the site-access boundary is
enforced on every tool (not just on the raw data queries generally, but on
each individual tool definition Jordan has access to).
