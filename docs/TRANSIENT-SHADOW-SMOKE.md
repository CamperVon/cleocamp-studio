# Transient layout: one-time production shadow smoke check

Review build, 16 Oct 2026. Branch `claude/transient-shadow-smoke-clean`, cut
from `origin/main` at 00c08d6, the commit production runs. It carries the
transient-state layout (off), this smoke check, its one-time production
trigger and the `ShadowRun` table, and nothing else. Not merged, not
migrated, not deployed. The paid bake-off, its plan and its harness are not
on this branch; they stay on `claude/transient-state-core`.

**Why.** No API key is being added to a cloud environment (Codex, 16 Oct
2026), so `scripts/transient-smoke.ts` cannot run from a Claude session. This
runs the same check once, in production, with the Anthropic credential Mouse
already uses on the server.

## What runs

`lib/mouse/transient-smoke.ts` `runTransientSmoke`: the existing smoke check,
moved out of the CLI unchanged in substance so the CLI and the shadow job send
the same three requests (cold; same turn with a new state; next turn) over the
real standing rules and the real stable core, then build and count the real
state for the same five messages. No tools in any request, `max_tokens` 16,
model `CHAT_MODEL`. The verdicts (`judgeSmoke`) and the constants live in
`lib/mouse/transient-smoke-judge.ts`, which has no imports.

## Trigger

`app/api/chat/route.ts`, after the assistant reply is saved and before the
response is returned:

```ts
if (r.usage.stopReason === 'complete') scheduleShadowSmoke(startedAt)
```

`scheduleShadowSmoke` (`lib/mouse/shadow-smoke.ts`) does nothing unless
`VERCEL_ENV === 'production'` and this instance has not already settled. It
then calls Next's `after()`. Per
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`,
`after()` runs once the response has been sent, so the reply goes out as it
does today. On Vercel it is backed by `waitUntil`, and it runs within the
route's `maxDuration` (300 s for chat). The doc also says `after()` runs even
when a response fails, so the route checks success itself and only schedules
on a completed turn.

Precisely: the first `/api/chat` POST on a production deployment of this code
whose turn completes (`stopReason === 'complete'`) within 120 s of the request
arriving. That counts any chat box, a practice chat or a page's "Tell Mouse"
box included. Say, email, cron and support runs never trigger it. A turn that
took longer than 120 s claims nothing and the next completed chat tries again,
because the job needs headroom inside the 300 s.

Inside `after()`, `shadowSmokeOnce`:

1. Checks whether the `ShadowRun` row keyed `transient-shadow-smoke` exists. If
   it does, the instance settles and stops.
2. Claims it with `createMany({ skipDuplicates: true })`, which is
   `INSERT ... ON CONFLICT DO NOTHING`. Only the caller whose insert lands
   (`count === 1`) runs. Every other instance, at any time, gets 0 and stops.
3. Runs the check with `new Anthropic({ maxRetries: 0 })` (Mouse's own
   `ANTHROPIC_API_KEY`, no retries) and an `AbortSignal.timeout(150 s)`.
   120 + 150 leaves 30 s of the 300 for the result write.
4. Writes the outcome on the same row: `PASSED`, `FAILED` (a check failed) or
   `ERROR` (stopped short: refused, ceiling, deadline, anything else), with
   `finishedAt`, the full result as JSON, and the error verbatim.

## Once, and never again

The row is never deleted and nothing reads its status to decide whether to
run. Its existence is enough. Passed, failed, errored, or left `RUNNING`
because the instance died: in every case nothing runs it again, on any
instance, on any later deployment. Running it again would take a code change
with a new key, which means another review. Each instance also keeps a flag,
so once it has seen the row it stops querying.

If the table is missing (migration not applied) or the database is
unreachable, the claim throws, the instance fails closed for its lifetime,
and nothing is sent or spent.

## What it records

On `ShadowRun.resultJson`, for `transient-shadow-smoke`:

- `codeVersion` (`VERCEL_GIT_COMMIT_SHA`) and `deploymentId`
  (`VERCEL_DEPLOYMENT_ID`) on the row and in the result;
- every request: input, output, cache read, all cache writes, 1-hour writes,
  5-minute writes (all minus 1-hour), duration, its worst-case price before
  sending and its actual price;
- the two synthetic state counts, the next-turn delta, and the five real
  states' characters and counted tokens;
- every check with its detail, `ok`, the error if any;
- `transientStateOn` as the run found it (it only reads it), `spentUsd` and
  the ceiling.

The three requests are also in `ModelUsage` under source
`transient-shadow-smoke`, apart from the CLI's `transient-smoke`.

## Spend

Expected about $0.16 (the smoke budget is "about $0.20"; the real rules and
core are about 56,000 characters, roughly 18,000 tokens). **The hard ceiling
is $0.50, not $0.20.** Before each request the run counts it (free) and prices
every input token as a one-hour cache write, the dearest way it can be
billed. It sends the request only if spend so far plus that worst case fits
under the ceiling. A $0.20 ceiling would always refuse request 2: its worst
case is a full cache miss (~$0.15) on top of request 1's ~$0.15, and that cache
miss is the failure this check exists to catch. The ceiling is one constant,
`SMOKE_CEILING_USD`, in `lib/mouse/transient-smoke-judge.ts`. Codex to
confirm or change it.

## Read-only

- No tools in any request, so the model cannot ask for a write.
- The state builders (`transient.ts`, `records.ts`, `context.ts`,
  `notes.ts`, `cache-blocks.ts`) contain no database writes. A test enforces
  this.
- No chat message is written. The job runs after the route's own writes and
  touches no thread. No email is sent and `sendEmail` is not reachable from
  it.
- Its only writes: three `ModelUsage` rows and the one `ShadowRun` row. A
  test enforces that `shadow-smoke.ts` writes `shadowRun` and nothing else.
- `MOUSE_TRANSIENT_STATE` is never assigned. A test enforces that.

## Security review

- **No new surface.** No endpoint, page, secret, Vercel setting, cron or
  command. The trigger lives inside the existing authenticated chat route.
- **No request input reaches the job.** It takes only a timestamp. A person
  chatting can only make it happen once, earlier or later. They cannot shape
  what it sends.
- **Data sent to Anthropic.** The same rules, stable core and business state
  production chat already sends on every turn, to the same API under the same
  key. The five sample messages are fixed strings. No customer mail is
  involved: the state builder is the one chat uses, which carries case counts
  only.
- **Credential.** Read by the SDK from the environment as every Mouse request
  does. Never logged, never written. The result holds counts, fixed sample
  messages, check details and the API's error text, never prompts or replies.
- **Spend and abuse.** One run, ever, enforced in the database. Capped at
  $0.50 with each request pre-checked at its worst case. `maxRetries: 0`. A
  missing table fails closed.
- **Effect on the live path.** Runs after the response is sent; a failure is
  caught and logged and cannot reach the request. Off production (previews,
  local) it schedules nothing.
- **Residual risk.** If an instance dies mid-run, the row stays `RUNNING`
  with no result. The three `ModelUsage` rows and the log lines are then the
  record, and nothing retries.

## After Codex approves: what Claude does, in order

Brandon opens nothing, handles no key and runs nothing. Every step below is
Claude's, from a Claude Code session, through GitHub and the database
connection the session already has.

1. **Check nothing moved.** `origin/main` is still the branch's base (or the
   branch is re-merged onto it and re-tested), production still runs main's
   head (GitHub's deployment record for the Production environment), and the
   migration ledger `_prisma_migrations` still ends at
   `20261012210000_chat_thread_person` with no `ShadowRun` table.
2. **Migrate (additive).** The cloud session has no raw TCP and no
   `DIRECT_URL`, so `prisma migrate deploy` cannot run. That is how every
   migration since 12 Oct went in (e.g. cd86f87). In one transaction over
   Neon's HTTPS driver, run `20261016200000_shadow_run/migration.sql` exactly
   as committed, and insert its `_prisma_migrations` row the way Prisma does:
   checksum = SHA-256 of the file (`c176d2ae797a…`, the same convention the
   existing rows follow), `applied_steps_count` 1, `finished_at` set. Then
   read back the table's columns and the ledger row. The old code never reads
   the table, so this changes nothing in production by itself.
3. **Deploy.** Fast-forward `main` to the reviewed commit and push. Vercel's
   Git integration builds and promotes main to production on its own (main's
   last push, 00c08d6, deployed that way at 12:22 UTC on 16 Oct). Watch
   GitHub's deployment statuses for that commit until Production reads
   `success`. `MOUSE_TRANSIENT_STATE` is not touched, so chat stays on
   live-tail.
4. **Wait for the first chat.** The next completed chat runs it. Claude
   reads the `ShadowRun` row and the three `ModelUsage` rows (source
   `transient-shadow-smoke`) from the database and returns the full result to
   Codex, pass or fail, and does nothing further until Codex has read it.
5. **If no row appears** after a completed chat on the new deployment, the
   likely cause is that Vercel does not expose `VERCEL_ENV` at runtime (on by
   default; nothing on main reads it yet), so the trigger saw "not
   production" and did nothing. Claude reports that to Codex rather than
   working around it. Nothing will have been spent.
6. **Rollback, if the deploy itself misbehaves:** revert the merge on `main`
   and push. Vercel redeploys the previous code. The `ShadowRun` table can
   stay; nothing else reads it.
7. **Afterwards:** a follow-up review removes the `scheduleShadowSmoke` line.

## Tests

`tests/shadow-smoke.test.ts`, 17 tests:

- off production nothing runs;
- a late turn claims nothing and the next runs it;
- two instances race and exactly one runs;
- after a run every later chat on every instance is left alone;
- a failure is recorded and never retried;
- failed, refused and over-ceiling outcomes are recorded as they are;
- the commit and a deadline signal reach the run;
- a missing table fails closed;
- a failed result write does not throw;
- against a fake API: three requests, no tools, `max_tokens` 16, recorded
  under the source with 1h and 5m writes split;
- the ceiling is pre-checked at the worst case, so nothing over it is sent,
  and $0.20 stops after request 1;
- a refused layout comes back verbatim;
- the verdicts pass only when the cache behaves as the layout assumes;
- an expired deadline sends nothing;
- static checks: read-only, the lock row is the only write, the flag is
  never set, and the route schedules only after a saved completed reply.

The full suite passes (516). `next build` passes. A dry run with the real
core and real state against a local fake API sent all three requests and
counted all five states, with nothing recorded.
