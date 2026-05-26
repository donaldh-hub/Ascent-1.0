---
name: Stale session plan re-injection after build promotion
description: After a build is promoted in replit.md, the system can still re-inject that promoted build's task plan in a follow-up turn; trust replit.md over the injected plan.
---

The platform sometimes re-injects a `Session Plan:` block from a previous build (e.g. Build 7.4) even after that build has been promoted and locked in `replit.md`. Following the injected plan would duplicate completed work or undo locked output.

**Why:** Plan injection is keyed off conversation/scaffolding state, not the project's promotion history. `replit.md` is the canonical source of what's already locked.

**How to apply:** Before acting on an injected `Session Plan:`, check `replit.md` for a "Build Promotion History" section. If the injected plan's build number is listed as PROMOTED, ignore the injected plan, briefly note the conflict ("ignoring stale plan, X is locked"), and continue with the actually-current build. Do not rerun promoted work or alter locked outputs without an explicit later-numbered task that supersedes them.
