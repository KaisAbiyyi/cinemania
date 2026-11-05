# CineMatch — Agent Execution Contract

> **MUST READ before touching this repository.** Applies to Gemini 3.8 Flash, Codex, Claude, ChatGPT, and other agents working on `KaisAbiyyi/cinemania`.
>
> **Source of truth:** [CineMatch governance in Notion](https://app.notion.com/p/40fc4a6aaf7381169c17ee5584d48fef) · [Project Hub / Kanban](https://app.notion.com/p/40cc4a6aaf73813bab68ef3e38d75cab) · [29 GitHub issue contracts](https://github.com/KaisAbiyyi/cinemania/issues).
>
> This document is a mandatory **human/agent workflow contract**, not a claim that technical enforcement (branch protection, CI, webhooks, status sync) is installed. Never invent such enforcement.

## 0. Precedence and safety

1. Explicit owner authorization and task-specific security/acceptance gates take precedence.
2. Read the complete current **GitHub issue and comments**, linked **Notion task**, this `AGENTS.md`, and the [master plan](https://app.notion.com/p/40fc4a6aaf73814b8582e70922f15753) for the assigned CINE-XXX task. Read live branch state, prior receipts, active claims and AND dependencies.
3. If requirements conflict, **STOP the conflicting action**, quote both references, and ask for an explicit decision. Do not silently reinterpret or waive gates.
4. **Never** push directly to `main`, merge, deploy production, rotate secrets, alter protections, run destructive production migrations, or use owner accounts without explicit owner authorization.
5. An agent's confident claim is not evidence. Source files, checks, logs, linked receipts and reviewer-verifiable artifacts are evidence.

## 1. Task claim and scope contract (mandatory)

Before doing any task implementation or repeatable audit:

- Identify task ID, exact title, priority, issue URL, Notion card, assigned model/runtime build, actor/session, current UTC timestamp, repository and baseline SHA.
- Confirm **every AND predecessor is accepted Done**; check live locks and other claims. If any predecessor is only Review, PARTIAL, FAIL or unknown, do not claim downstream work.
- Publish a durable **CLAIM** on the GitHub issue and update the Notion task to Claimed where appropriate; include lock scope, planned branch, base SHA, next action, and execution environment. A review continuation already in Review should post a **CONTINUE / CLAIM RENEWAL** and preserve Review status, not reset it.
- Resource lock is scoped by files/component; different tasks may run concurrently only with no dependency or lock collision. No unauthorized reclaim. A reclaim requires evidence of previous owner/session, timeout/blocker, explicit lock release/fence and new epoch.
- State whether work is **READ-ONLY AUDIT**, **DOCS-ONLY**, **IMPLEMENTATION**, **REVIEW**, **OWNER/NATIVE**, or **RELEASE**. Never upgrade scope implicitly.
- Keep the work in this canonical repository. Historical `cinemania-tmp` repositories may be referenced but not changed without a separate issue.

### Stop conditions

Stop **the unsafe or blocked operation** (not necessarily all useful work) when: ownership ambiguous; predecessor not accepted; lock conflict; task contract unclear in a security-relevant way; secret required but unavailable; no valid way to preserve evidence; a mandatory reviewer/owner gate is missing; unexpected changes in checked-out files; or source SHA differs from claimed SHA. Record exactly what remains blocked.

## 2. Non-negotiable evidence rules

For every requirement, classify as one of:

- **PASS:** command/assertion actually executed and succeeded against the specified exact SHA/environment.
- **FAIL:** assertion actually executed and failed; preserve redacted error and exit code.
- **BLOCKED:** prerequisite/tool/environment prevents execution; state precisely what prevented it.
- **NOT RUN:** execution not attempted, with reason.
- **NOT VERIFIED:** claim/source/artifact cannot independently be checked.

`SKIPPED` may be used for documented legitimately out-of-scope cases only, not to bypass mandatory acceptance.

Never mark `npm ci`, typecheck, lint, build, integration, E2E, CI, device, security, performance, or deployment PASS without **command + cwd + toolchain + exact SHA + exit code + evidence**. If install fails, explicitly mark all dependent checks BLOCKED unless independently run in a declared, valid alternate environment. **A failing product build can still be a valid audit finding**; do not falsely fail or pass an audit to hide product breakage.

Do **not** use `--force` or `--legacy-peer-deps` to conceal an install failure. If separately authorized for diagnosis, label the result clearly as **nonstandard** and never call it a clean reproducible install.

### Mandatory durable evidence receipt

Publish **`CINE-XXX — Evidence Receipt`** on a readable GitHub issue/PR with the following exact fields:

```text
TASK / ISSUE / NOTION:
ACTOR / MODEL / SESSION / CLAIM / UTC:
REPO / BASE SHA / HEAD SHA / TREE SHA (if available) / BRANCH:
EXECUTION MODE / RESOURCE LOCK / DEPENDENCIES:
DIFF / CHANGED FILES / OUT-OF-SCOPE CONFIRMATION:
INVENTORY RULES / PATH:LINE REFERENCES:
CHECK MATRIX:
  <test> | <cwd> | <command> | <runtime> | <exit code> |
  PASS / FAIL / BLOCKED / NOT RUN / NOT VERIFIED | <evidence permalink>
ACCEPTANCE MATRIX:
  <criterion> | <status> | <exact evidence location>
SECURITY / REGRESSION / SELF-REVIEW:
KNOWN GAPS / LIMITATIONS / OWNER GATES:
PR / DOCUMENT PERMALINK / NEXT ACTION:
```

- All links must actually resolve and lead to the described artifact. A filename such as `CINE-001-baseline-report.md`, `http://CINE-001-baseline-report.md`, ephemeral local filesystem path, chat-only file, claim of upload, or unpublished branch is **NOT** an acceptable permanent evidence URL.
- Attach redacted raw logs in the PR, link a GitHub Actions run/artifact, or use a short exact command-output excerpt in the issue. Do not paste API keys, cookies, private tokens, session capabilities, personal data, or full `.env`.
- Counts are only valid with a documented counting rule: **source files vs routable endpoints; including/excluding root; dynamic folders; route files vs HTTP methods**. Use exact `path:line` references for important findings. `process.env` references are **not** proof the variables are always runtime-required.
- Distinguish direct observation, inference, and unverified assumption. Include tool failures. Never fabricate SHA, version, benchmark, timestamp, test result, screenshots, links, or PR.
- Never cite CI run A as exact-head qualification of commit B. A changed HEAD invalidates previous exact-head qualification unless review explicitly proves the check remains applicable.

## 3. Execution sequence

1. **PREFLIGHT:** read contract, live evidence and already completed work; verify SHA, dependencies, claim/locks. Don't redo evidence work without need.
2. **PLAN BOUNDED WORK:** record exact acceptance matrix, failure cases, affected paths, commands. For audit tasks, default to no product file edits.
3. **DO ONLY SCOPED WORK:** keep product decisions inside issue contract. CINE-002/003 own Next.js and dependency repairs, *not* CINE-001. Make one coherent scoped PR, no unrelated rewrites.
4. **VERIFY EXACT HEAD:** run all checks specified in the issue. If something cannot run, report BLOCKED/NOT RUN truthfully with causes and attempted remediation. Save logs and artifacts.
5. **SELF-REVIEW:** inspect exact diff against base, dependencies, security, API contracts, privacy, performance, tests, unintended files, and acceptance criteria; label it "Self-review — <actor/session>".
6. **PUBLISH BEFORE CLAIMING COMPLETION:** push report/PR, evidence receipt **and mandatory Implementation Summary**; verify links by reading them back and archive transferable lessons in the Notion learning log. Synchronize Notion Evidence, Next Action, Claim Owner, Status and Focus Lane. Never say Done when still waiting on owner/review/tests.
7. **OWNER AND RE-REVIEW GATE:** independent review if the issue explicitly requires it (including CINE-001 review and CINE-029 evaluation); implementor self-review is mandatory everywhere. Owner's existing manual merge gate remains binding. A PR is not merged because CI is green.
8. **HANDOFF:** preserve exact SHA, last action, artifacts, locks, results matrix and next action. After interruptions, resume from the durable checkpoint; do not restart blindly.

## 4. Status and Kanban invariants

- Lifecycle: `Ready → Claimed/In Progress → Review → Done`. `Blocked` and `Backlog` reflect prerequisite readiness; `Reclaim` is a controlled claim handoff, not an invented progress status.
- **Now:** all AND-eligible or actually active/reviewable tasks (unlimited for CineMatch), sorted P0 before P1/P2. Ready does **not** mean claimed.
- **Up Next:** only blocked *direct successors* of Now, with all other predecessors Done or already in Now. No arbitrary backlog in this lane.
- **Last Done:** at most five newest accepted Done tasks. Don't move a card here just because a chat report said "finished".
- **Review / CHANGES REQUIRED:** remain in Now, preserve existing claim/evidence and comments. Don't promote downstream issues.
- On claim, failure, new evidence, PR, merge, release, handoff or re-review, recalculate the board and sync **both Notion and GitHub**. If no permission or connector to update one side, explicitly mark sync **BLOCKED** and supply the link/action; never claim synced.

## 5. Technical safety and UI autonomy

- Gemini owns **visual design judgment for F3**: spacing, layout, design system, animation and polished UI interactions. It does **not** own rules of the matching engine, quorum, server authority, API security, cookie rules, TMDB policy, accessibility requirements, or acceptance thresholds.
- App Router / Next.js: latest **stable** at migration time only, use official upgrade instructions; don't introduce canary or indiscriminate `force-dynamic`, client-only rendering, cross-user cache sharing, or package-manager drift. Any optimization requires before/after profile, declared environment, and no correctness regression.
- CineMatch MVP: guest 2–5 participants; one frozen roster, 20-title server deck, one immutable LIKE/SKIP vote per member/title, *unanimous* match only, server-authoritative transitions, secure guest identity, reconnect/idempotency, no leaking another room's events.
- Never expose TMDB/server tokens, use production secrets in CI, disable security to get green tests, or claim mocked tests prove owner/production security. Report missing external access plainly.

## 6. CINE-001 case study and historical audit-failure fence (2026-11-05)

**Historical review checkpoint (not live status):** CINE-001 initially was `Review — PARTIAL / CHANGES REQUIRED`; the initial audit needed corrections. [First independent review](https://github.com/KaisAbiyyi/cinemania/issues/3#issuecomment-6654862453). The corrected [CINE-001 PR #33](https://github.com/KaisAbiyyi/cinemania/pull/33) later passed bounded independent audit-evidence review at HEAD `eb45fa01839289272cd476f18b0519aed59e3889`. Consult the **live Notion task and GitHub issue** for current Done/Blocked status; never use this historical paragraph as a live dependency gate.

Pinned source: `a7b93e9b44d56ea50bb877ef47660e8bb021d358`.

Confirmed by independent source inspection: **29 `page.tsx` files** (including root), **27 `api/**/route.ts` files**, **5 unique `process.env` identifiers**; no conventional automated test files in the checked Git tree. Previous summary claimed 28/18/4. Explain any purposeful alternative counting rules with enumerated exclusions, otherwise correct numbers and include lists. Five env identifiers: `TMDB_API_RAT`, `YOUTUBE_API_KEY`, `IPINFO_TOKEN`, `NEXT_PUBLIC_TMDB_POSTER_URL`, `NEXT_PUBLIC_IMAGE_BASE_URL` (names only).

Reproduced in a separate isolated copy: `npm ci` fails `ERESOLVE`, `cmdk@1.0.0` React peer `^18.0.0` versus resolved React 19; `package-lock.json` Next.js 15.2.1 versus `package.json` Next.js 15.2.8. Record these as existing **product FAIL** and **audit finding PASS**, never as "fixed."

**CINE-001 completion requirements:** complete report with exact file/SHA, paths, routes, API, env names/dataflow, working/unknown/broken classification; independent count reconciliation; exact installation/typecheck/build/lint matrix with honest BLOCKED/NOT RUN statuses; durable GitHub issue evidence and docs-only PR as required by its issue (or explicit owner-approved contract amendment). **No code/dependency changes as part of CINE-001.** Do not mark Done before re-review and owner gate.

## 7. Implementation Summary + verified learning loop (MANDATORY for EVERY task)

**Purpose:** Persist good engineering *behavior*, not claim the foundation model has retrained or acquired hidden memory. Each new agent session must explicitly reread `AGENTS.md`, the relevant previous issues' summaries, and the [CineMatch Agent Learning Log](https://app.notion.com/p/40fc4a6aaf738176a09ed095a929f27e). Memory is the **retrievable record and mandatory preflight**, not guaranteed neural weight improvement.

**Hard review gate:** Before proposing `Review` or saying `finished`, publish a durable **`CINE-XXX — Implementation Summary`** on the exact GitHub task issue or PR, and link it from Notion Evidence / Next Action. This applies to implementation, audits, docs, refactors, research, CI and failed/partial attempts. **If the summary is absent, the task is NOT Review Ready** even if tests pass. Publish the summary *in addition to* the `Evidence Receipt`, not instead of it.

Use this required template (concise but complete, no filler):

```text
# CINE-XXX — Implementation Summary
IDENTITY: task / model build / agent+session / claim / date UTC
SOURCE: base SHA / exact HEAD SHA / tree SHA if available / PR / issue
OBJECTIVE & SCOPE: requested outcome / constraints / exclusions
DESIGN DECISIONS: approach, tradeoffs, rejected alternatives if material
IMPLEMENTED: changed files (with pinned links), behavior and API contracts
VERIFICATION: command + cwd + tool versions + exit + verdict + artifact;
  positive/negative/regression tests, or BLOCKED/NOT RUN with reasons
ACCEPTANCE: each criterion -> evidence URL and status
SELF-REVIEW: exact diff, security, privacy, tests, scope, known gaps
REVIEW FEEDBACK: actual reviewer findings / fixes / still open; never erase defects
LESSONS: observed mistake or new discovery -> verified cause or hypothesis ->
  concrete future guardrail -> relevance to next task;
  OR "No new verified lesson" with a short reason
HANDOFF: unresolved risks / required owner gate / next actor / next action
LINKS: GitHub issue / PR / Evidence Receipt / Notion task / learning-log entry
```

**Continuous-improvement protocol:**
1. Before claim, read at least the relevant latest *verified* learning-log entries, then explicitly include a **"Risks recalled / checks applied"** line in the task plan. Do not blindly repeat other agents' claims.
2. After tests, compare planned checks with what actually failed or required re-review. Identify the mechanism, not just a vague "be more careful".
3. Publish summary and receipt against the exact HEAD, independently check links and claimed paths, then add only evidence-backed new lessons to the Notion register, citing the originating issue/review/SHA. Mark uncertain hypotheses *provisional*.
4. Future agent sessions must apply relevant guardrails; reviewer checks for the concrete mitigation in source, tests and receipt. Repeated faults are reported and tracked in CINE-029's model-quality assessment; a passing final result does not erase past correction rounds.
5. Do not quietly rewrite earlier lessons or force a "lesson" when none exists. An agent may propose updates to governance, but **must not self-approve changes to contracts, acceptance thresholds or security policy**.
6. For merged work, append the final merge SHA and closure outcome in the summary or issue (preserve original exact-HEAD evidence), then synchronize Notion and recalculate board.

### Existing lessons that MUST be recalled

- **L-001:** never infer architecture from dependencies; open real files and cite exact pinned `path:line` instead of inventing `ReactQueryProvider.tsx` / `useMediaStore.ts`.
- **L-002:** never use local `file://` or `http://filename.md` as permanent evidence; test GitHub permalink.
- **L-003:** separate source file counts, runtime verification, implementor commands and independent reviewer reproductions.
- **L-004:** audit evidence PASS can coexist with product install/build FAIL; preserve the defect for the correct successor.

Full record: [Notion Agent Learning Log & Implementation Summaries](https://app.notion.com/p/40fc4a6aaf738176a09ed095a929f27e).

## 8. Anti-fabrication review probes

For every important claim, the reviewer should: fetch exact SHA; independently count claimed source items; reproduce at least one critical positive/negative assertion in an isolated environment; verify permalink content; compare commit diffs; verify tests against the *same HEAD*; and compare issue/PR/Notion status. Log disagreements as specific blocking review findings, not model-quality opinions.

**Failure to provide evidence is not automatically proof of incorrect code.** It is, however, a **FAIL of evidence discipline** and blocks acceptance.
