# Jordan as a real interactive conversation (parked feature)

Status: parked, not started. Flagged the same night as the flagged-issues
feature (PR #4 work) — user considers this an important differentiator.

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

## Rough shape (not designed in detail yet)

- A real chat endpoint: user asks a question, the backend pulls the
  relevant slice of *their* actual accessible-sites data (current signals,
  recent work orders, whatever's relevant) as context, and an LLM
  generates the answer — not a template lookup.
- Needs conversation state — Jordan should remember what was already asked
  in the session, not treat every message as a cold start.
- Should stay bounded by `req.accessibleSiteIds` — Jordan must never
  reason over or mention data from a site the asking user can't see.
- Likely reuses the coach-preferences/coach-weekly-summaries tables for
  personalization context, but the underlying generation moves from
  templates to a real LLM call.
- Needs a decision on which provider/SDK to reintroduce and how the system
  prompt is constructed per-user (what data gets included, how it's kept
  from ballooning cost/latency on every message).

## Next step when picked up

Don't jump straight to code — this needs a short design pass first:
what data actually goes into the prompt per question, how conversation
history is stored, and how the site-access boundary is enforced on
whatever context gets assembled (not just on the raw data queries, but on
what ends up inside the prompt itself).
