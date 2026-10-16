# Transient layout: one-time production shadow bake-off

Review build, 16 Oct 2026. Branch `claude/transient-shadow-bakeoff`, cut from
`origin/main` at `30207c4`, the commit production runs. Not merged, not
migrated (no migration needed: it uses the existing `ShadowRun` table), not
deployed. `MOUSE_TRANSIENT_STATE` is not read to decide anything here, and
nothing sets it.

This is the last cost-validation stage. Its only possible outcome is Codex's
review: enable the transient state for a controlled canary, or abandon it.

## What it compares

The live-tail layout production runs today against the transient-state
layout, on the same scenarios, as full Mouse turns: same model (`CHAT_MODEL`),
the same standing rules, both with Mouse's full tool list (the transient side
also gets `list_records`, which it needs). Live tail is called with
production chat's own options (`notes: 'index'`, the catalogue mode chat
uses, `prefetchForMessage`, `liveTail: true`). The transient side gets
`transient` with the access chat would give (`inventoryWrites` and
`shopifyWrites` as production has them) and counts its state's tokens.
Neither uses the read lane.

## Writes: stopped

Every turn is a practice turn (`runAgent` `practice: true`):
`practiceStop` lets only look-up tools run (`PRACTICE_TOOLS` =
`LOOK_UP_KIND`). Any tool that would change something (stock, notes, to-dos,
orders, email, Shopify, calendar) returns "not done" plus what it would have
done. Practice also skips the troubleshooting log and every post-turn write
in `runAgent`. No chat thread is written: the bake-off calls `runAgent`
directly, never `chatTurn`, with a thread id that does not exist.

Belt and braces: after each step, any tool call that was not stopped and is
not a look-up fails the bake-off ("write risk"). The process environment is
never changed, because it is shared with real traffic on the same instance,
so no `EMAIL_DRY_RUN` or `INVENTORY_WRITES` toggling. What is written:
`ModelUsage` rows under source `transient-shadow-bakeoff`, and the result on
the `ShadowRun` row.

No customer email: Mouse's email tools never read mail sent to support@
(`lib/email-lookup.ts`, refused in the query and in `open_email`). Stored
tool calls keep no email text (`storedResult`), and the email scenario names
a vendor.

## Trigger and pacing

`app/api/chat/route.ts`, after a reply completes, calls
`scheduleShadowBakeoff(startedAt)` next to the existing smoke trigger. That
does nothing unless `VERCEL_ENV === 'production'`, and runs inside Next's
`after()`, so the real reply is sent first and is not changed or delayed. No
endpoint, page, cron, setting, key or user command.

A full Mouse turn takes 20 s of model time at the median and up to 94 s
(production since 13 Oct, 74 replies). The whole set cannot fit in one route's
300 s, so **each completed chat runs one scenario**, with both layouts **at the
same time** on the same records, until all six are done. A step:

- starts only if the chat turn finished within 100 s of its request arriving
  (`LATEST_START_MS`);
- must end by 280 s into the route (`ROUTE_BUDGET_MS`); every request carries
  that deadline as an abort signal.

## Lock and state

The `ShadowRun` row keyed `transient-shadow-bakeoff` is both lock and record:

    (no row) → RUNNING (plan, then scenario 1) → WAITING → RUNNING → … → COMPLETE
                                   any failure, at any point → FAILED (final)

- **First claim:** `INSERT … ON CONFLICT DO NOTHING`. Only the caller whose
  insert lands plans and runs scenario 1.
- **Later steps:** `UPDATE … WHERE status = 'WAITING'`. Only the caller whose
  update lands runs the step.
- **A step cut off:** if a step stays RUNNING more than 10 minutes (the
  function was cut off mid-step), the next caller marks it FAILED instead of
  resuming it.
- **No retries:** nothing is ever retried. The Anthropic client has
  `maxRetries: 0`, `runLoop`'s one 503 resend is off (`retryProvider: false`),
  and the server-side fallback is not asked for. So no request runs on a
  model the cap did not price.

The plan, meaning the exact scenario texts and fixtures, is fixed at the first
claim and stored, and every later step runs from it.

## The scenarios

Built from current real records when the bake-off is first claimed (picked,
never changed). As they resolve today:

| # | id | Kind | Turn(s) | Fact check (informational) |
|---|---|---|---|---|
| 1 | lookup | look-up | "How many Cleo Tee in Black, size 1 do we have right now?" | names the count on file (327 today) |
| 2 | notes | notes / record detail | "What lining does the Story Dress use?" | says Tibetan cotton, as its notes do |
| 3 | inventory | inventory update (stopped) | "We just counted 6 of the Cleo Tee in Black, size 1 in the studio. Log that." | would have called `log_inventory_event` on that variant, or asked |
| 4 | po-receipt | PO receipt (stopped) | "PO 2360 arrived in full today." | would have logged RECEIVED, or asked |
| 5 | email | email search | "What did Calamo Silk last email us about?" | uses a word from that email's subject |
| 6 | multi-round | multi-round, two turns | "Which open purchase orders are past their due date, and what is still owed on each?" then "Which of those has been late the longest, and what did we last hear from that vendor?" | names an overdue PO (2387, 2362, 2378, 2398 today) |

That is 7 turns a layout, 14 in all. The second turn of #6 measures each
layout's next-turn caching. If any scenario cannot be built from the records
on the day, the bake-off fails before spending anything.

## Money: the $10 ceiling

1. **Before any spend, and again before each step, the rest of the set must
   fit:** spent + turns left × $0.53125 ≤ $10. $0.53125 is production's mean
   cost per completed chat reply since 13 Oct ($0.425 over 74 replies,
   measured 16 Oct 2026) plus 25%. For the full set: 14 × $0.53125 =
   **$7.44 estimated**. If it does not fit, nothing more is spent and the
   bake-off fails with the figures. It never runs a partial set knowingly.
2. **Before each request:** the request as it will be sent (system, tools,
   messages) is counted with the token-count endpoint, which is free. It is
   priced at its worst case: every input token at the highest input rate (the
   one-hour cache write, $8 per million on Opus 5.5), plus `max_tokens` in
   full at $20 per million. If spent + everything reserved + this worst case
   would pass $10, it is never sent and the bake-off fails. Otherwise the
   worst case is reserved, and settles to the request's actual cost when it
   returns. A request that errors stays at its worst case, since it may still
   be billed.

**Maximum cost: $10.00.** A request can bill at most its worst case:
`tests/shadow-bakeoff.test.ts` checks this, priced from `lib/mouse/prices.ts`.
No request goes out without a reservation that keeps the total at or under
$10, and the two layouts' outstanding reservations count together. The
token-count calls cost nothing. For scale:

- a 110k-token prompt (production's median largest) reserves $0.88 input +
  $0.32 output = $1.20;
- the largest production prompt (164,874 tokens) reserves $1.64;
- a turn is at most 6 requests (plus a wrap-up) and at most 24,000 output
  tokens.

**Expected cost:** about 14 × $0.425 = $5.95 if both layouts cost what
production does today. The transient side is expected to cost less.

## Failure: closed, final, never retried

A step fails the whole bake-off, which then records FAILED with the reason and
the partial result, if:

- a request would pass the cap, or the rest no longer fits;
- the deadline is reached, or any request or the step throws;
- any turn does not complete (`stopReason` other than `complete`);
- any tool other than a look-up ran (a write risk);
- a step is cut off (stale RUNNING).

## The result, for Codex

`ShadowRun.resultJson` holds:

- `scenarios`: the plan;
- `steps[]`, one per scenario. Each has the code version and deployment, the
  production flags at the time (live tail, transient, catalogue index,
  inventory writes) and, for each layout's turn:
  - the final reply, `stopReason` and provider error;
  - every tool call (name, status, whether stopped, whether run, input,
    result size);
  - every request: input, cache read, cache write (1-hour and 5-minute),
    output, duration, tool rounds, look-ups, state characters and counted
    state tokens, actual cost, worst case reserved, counted prompt tokens;
  - wall-clock latency and the fact check;
- `spentUsd`;
- `report`, the judge's report:
  - per layout: cost per completed turn, latency (median and max per turn),
    model time, cache writes (1-hour and 5-minute), cache reads, uncached
    input, output, first-request vs follow-on cost, tool calls, tool rounds,
    look-ups, stopped writes, state tokens;
  - the transient ÷ live-tail ratios;
  - every pair side by side.

  It says plainly: **quality is not judged**. Equivalence is not claimed or
  scored; each pair is for Codex to read, and the fact checks are
  informational.

The `ModelUsage` rows under `transient-shadow-bakeoff` are the independent
record of every request.

To read it: `npx tsx scripts/shadow-bakeoff-report.ts`, which is read-only.

## Files

- `lib/mouse/shadow-bakeoff.ts`: scenarios, the step runner, the lock and the trigger.
- `lib/mouse/shadow-bakeoff-judge.ts`: constants, cost maths, the ledger, checks and report (pure).
- `lib/mouse/agent.ts`: `shadowGuard` (reserve, settle, abort; no retry, no fallback) and `countStateTokens`. Production chat passes neither.
- `lib/mouse/runner.ts`: `retryProvider` (default true; false only for the bake-off).
- `app/api/chat/route.ts`: one call after a completed reply.
- `scripts/shadow-bakeoff-report.ts`: prints the stored result.
- `tests/shadow-bakeoff.test.ts`.
