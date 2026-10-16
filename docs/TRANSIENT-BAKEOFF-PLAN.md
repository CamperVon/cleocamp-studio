# Transient-state bake-off: revised plan (for Codex, before any spend)

Branch `claude/transient-state-core`. `MOUSE_TRANSIENT_STATE` stays off; the
live-tail deployment is unchanged; nothing here is merged or deployed. No
paid request has been made for this layout. Design: `docs/TRANSIENT-STATE.md`.

## What changed after Codex's review (16 Oct 2026)

| # | Finding | Fix |
|---|---|---|
| 1 | `input_tokens` recorded as the state's token size; it includes the message and uncached tool results | Production records the state's **characters** only. Tokens are counted on the state alone with Anthropic's token-count endpoint (`countStateTokens`: the state as a user message, less a one-character message), only when a run asks (`countStateTokens: true`, the smoke check and the bake-off). A missing or non-finite count is recorded as missing, and the size gate fails on any uncounted request. Test: a request with `input_tokens` 7,000 and no count records no token size. |
| 2 | Churn of 7 changes in 13 turns, against production's 39% | `churnSchedule(13)` derives it from production's counts (11 head and 3 tail-only in 36 replies): **4 head, 1 tail-only**, on turns 3, 5, 10 and 12 (head) and 8 (tail), never the first. 36 turns would give 11 and 3 exactly (tested). |
| 3 | Whole-section retrieval in `open_record` could return 20k+ characters and rebuild the prompt through tool results | Removed. `open_record` and its description are back to `main`, byte for byte. New `list_records`: one kind of record, one line each, at most 20 lines and 3,000 characters a page, paginated, with a query filter. It is offered to the transient layout **only** (`TRANSIENT_ONLY_TOOLS`), so the live-tail side's tools hash the same as `main` (checked: 93 tools, `202b701bc6b73a32`; rules `3c0e6fe8d14fa4c2`). Every tool result's size is recorded and reported, with the largest. |
| 4 | Mutable fields in the cached directory | The directory is names and ids only: products, colourways, variants (colour / size), active components. No retail, SKU, status, active flag, dye-house name or style number. What can still invalidate the core is classified in code (`DIRECTORY_INVALIDATED_BY`, `STABLE_SECTIONS_INVALIDATED_BY`) and measured: every run records the core's hash (`usage.core`), and the bake-off reports any change across turns. Core block: 25,968 → 20,417 characters. |
| 5 | A transient failure excused because live-tail also failed; human review on one turn only | Every required check must pass in **both** layouts; a check whose fixture is missing fails, never skips. A person judges **all 13 pairs** in `review.json` (verdict `ok` or `worse` each); acceptance is pending until every verdict is `ok`. `--accept <dir>` re-judges the saved run with the review, spending nothing. |
| 6 | No proof Anthropic accepts the layout | `scripts/transient-smoke.ts`: three real requests with the exact four-mark shape, built by the same functions chat uses. The bake-off refuses to start without a passed `smoke.json`. |

## Order of work, and who does what

Claude runs every script and writes every file. Brandon is asked for three
things only, none of them code: Codex's approval, a key in the environment
(after that approval), and a verdict on each of the 13 pairs.

1. **Codex reviews this branch and plan.** Free.
2. **API key.** Only after Codex approves: Brandon adds `ANTHROPIC_API_KEY` to
   the cloud environment's settings (never pasted into chat).
3. **Smoke check** (Claude runs it), about $0.20: `scripts/transient-smoke.ts`.
   Three short Opus requests over the real rules and the real stable core
   (tools left out to keep it cheap; they sit ahead of the first mark and do
   not change the marks), using `coreSystemBlocks` and
   `layoutTransientMessages`:
   - cold: rules (1h), core (1h), history (**1h mark**), the message (5-minute
     mark), the state after it. Pass: accepted, and the 1h marks wrote.
   - same turn, different state. Pass: **nothing written**, everything before
     the state read back, and the uncached input within 64 tokens of the
     state's own count (proving the state is the only uncached part).
   - next turn: history grown by one exchange, its mark moved down. Pass:
     the earlier prefix read back, only the new messages written, at 1h.
   - then, free: the real state for five representative messages, counted.
     Pass: average 8,000 tokens or less. A fail here stops the plan before
     the bake-off's spend.
   A refused layout is reported as such, and the plan stops there.
4. **Bake-off** (Claude runs it), roughly $8–12: `scripts/transient-bakeoff.ts`.
5. **Human review.** Claude publishes the 13 pairs as a private page, each
   with an "as good or better / worse" choice and a notes box. Brandon reads
   and taps; Claude copies the verdicts into `review.json` and re-judges the
   run (`--accept`, free).
6. **Back to Codex** (Claude): the branch, the layouts
   (`scripts/transient-layout.ts` output), `smoke.json`, `bakeoff.json`, the
   verdicts, the cost data and every failure.

## The bake-off

Same 13 practice turns in both layouts, one conversation each, interleaved
turn by turn with the first layout alternating; real Opus answers at chat's
effort; read lane in neither; catalogue in index mode, as production. Every
tool that would change something is stopped by practice; `EMAIL_DRY_RUN` is
forced on; usage recorded under `transient-bakeoff`. One primer per layout
warms that layout's tools and the rules, reported and excluded.

Record churn: on the 5 scheduled turns one line is added where a real change
lands (the live head or tail; the state). The requests are real and paid;
only the trigger is scheduled. Turns run back to back, which favours the
live-tail layout (43% of production messages come after its five-minute
blocks have expired).

| # | turn | required check (must pass in both layouts) |
|---|---|---|
| 1 | time zone: today's date and time in LA, and a PO's due date | names today's Los Angeles date |
| 2 | stock count for a real variant | states the count on file |
| 3 | stock write: "we counted 6, log that" | would have logged a count of 6 on that variant |
| 4 | stock-pause warning (inventory writing off) | says it is paused / noted, not applied |
| 5 | PO receipt for a real sent PO | would have received against it, or asked first |
| 6 | finance: cash, and is it old | gives the date the figure is as of |
| 7 | finance: friends-and-family price | does not work the price out itself |
| 8 | never size an order | person's judgement only |
| 9 | files: the W-9, line 3a | says partnership (P) |
| 10 | email lookup: Calamo on 3103 | says what Michael said (12.75 yd, ivory) |
| 11 | product notes: Story Dress lining | says Tibetan cotton |
| 12 | to-do awareness: tape | says one exists |
| 13 | multi-round: overdue POs and what is owed | names an overdue PO |

A required check whose record is missing on the day fails the run.

## Acceptance (all must hold)

1. Safety: no write ran in either layout.
2. Every required check passes in both layouts, and every turn finished.
3. Human review: all 13 pairs judged transient no worse.
4. Size: the state, counted on its own, averages 8,000 tokens or less over
   **every** transient request (no exclusions), with every request counted.
5. Cache writes: transient at most 50% of live-tail on the same turns.
6. Cost: production's completed-chat cost under live-tail (from the saved
   replies since 13 Oct), scaled by the replay's real cost ratio, about $0.30
   or below.

Reported, not gated: tool-result sizes (total and largest), look-ups and tool
rounds per turn, per-request cache reads and writes (1h and 5-minute), the
core's hash per turn, characters per counted token.

## Already checked, free

- 508 tests pass (layout marks and lifetimes; the state never in an earlier
  message and never kept; the cap; the frame; the stepped history window;
  access; the directory's contents; list paging; transient-only tools; the
  judge, the churn schedule and the smoke verdicts).
- `scripts/transient-layout.ts` captures both layouts through the real code
  path against a local server: the state is in every request of a turn
  including the tool follow-up, last, after every mark; at most four marks;
  no business data in the system prompt beyond the core; live-tail unchanged.
- The smoke check and the bake-off ran end to end against a local fake API
  (`BAKEOFF_DRY_RUN=1`): plumbing only, fake numbers, no claim drawn.
