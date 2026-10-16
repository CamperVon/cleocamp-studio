# Cached core, transient state (review build)

Branch `claude/transient-state-core`. Behind `MOUSE_TRANSIENT_STATE=1`, chat
only (`chatTurn`), **off by default**. Not merged, not deployed, no production
flag changed, no model choice changed.

## Why

Chat cost $0.427 per reply on 13–15 Oct 2026 (68 replies, 3.2 requests each),
under the live-tail layout. Where it went:

| | share | per request |
|---|---|---|
| cache writes, 5 minute | 33% | 8,791 tokens |
| uncached input (history, tool results) | 27% | 9,064 tokens |
| cache writes, 1 hour | 17% | 2,822 tokens |
| cache reads | 14% | 90,826 tokens |
| output | 10% | 668 tokens |

The live catalogue (products with counts, components with stock, the notes
index, open orders, forecasts, calendar, to-dos: about 89,000 characters,
measured at about 51,000 tokens on 13 Oct) sat in the system prompt under
five-minute marks, so any change to any of it rewrote all of it. The
conversation behind it was never cached at all.

## The layout

Order is Anthropic's: tools, then system, then messages. Four cache marks at
most; a one-hour mark must come before a five-minute one; a change anywhere
invalidates every mark after it.

### Before (live tail, production today)

Captured by `scripts/transient-layout.ts` from the real code path, request 1
of a practice turn on 16 Oct 2026:

| block | size | mark |
|---|---|---|
| tools (93 definitions) | 122,357 chars | (covered by the first mark) |
| system: SYSTEM_RULES | 36,060 chars | 1 hour |
| system: practice rules | 649 chars | none |
| system: stable catalogue (places, vendors, stores, people, document defaults) | 6,047 chars | 1 hour |
| system: live head (today, products, components, orders, runs, notes index, …) | 66,754 chars | 5 minutes |
| system: live tail (forecasts, alerts, calendar, money, emails, to-dos, support) | 22,614 chars | 5 minutes |
| messages: history | as sent | **none: never cached** |
| messages: the person's message (+ named records) | as sent | none |

### After (transient state)

Same turn, same capture:

| block | size | mark |
|---|---|---|
| tools (93 definitions) | 122,357 chars | (covered by the first mark) |
| system: SYSTEM_RULES | 36,060 chars | 1 hour |
| system: practice rules | 649 chars | none |
| system: TRANSIENT_RULES + stable core (the five stable sections + a directory of every product, variant, colourway and component by name and id, no counts) | 25,968 chars | 1 hour |
| messages: history, last block | as sent | **1 hour** |
| messages: this turn so far (the message; then each tool round), last block | as sent | 5 minutes |
| messages: `<business_state>` appended to the last message | 9,700–13,800 chars | **never cached, never saved** |

On request 2 (after a tool call) the five-minute mark moves to the tool
result and a fresh state follows it. The capture script checks, on what was
actually sent: the state is in every request of the turn, only as the last
block of the last message, after every mark; at most four marks; no business
data in the system prompt beyond the stable core; the live-tail layout is
unchanged. Full request bodies are written to a local folder for review (they
hold real business data, so they are not committed).

### The business state

Built from the records before **every** request of a turn: the first, each
tool follow-up, a retried request, the record-it and stock checks, and the
wrap-up. Never persisted: chat history is rebuilt from the saved rows, which
hold what Mouse said, and the runner sends the state in a copy of its
messages. An index, not the dossier:

- now (Los Angeles date and time with the offset), who is talking, practice,
  read lane, inventory writing on or PAUSED, Shopify write-back, last sync
- the records the message names (looked up again on every request), capped at
  4,000 characters
- urgent alerts in full; other alerts folded into one line; to-dos that are
  urgent or due within two days
- customer support: counts only, never a customer's words (unchanged policy)
- a stock board: finished-goods counts per variant for active and sampling
  products; components below zero
- one line per open PO and production run; the next seven days of calendar;
  forecasts that need ordering within three weeks or are blocked
- open questions by id and title; the other to-dos as a count
- notes: a count only; money as last recorded, with the standing rule

Everything else is fetched: `open_record` for a record (now also
`"section: <name>"` for a whole current list, exactly as the catalogue prints
it: products, components, purchase orders, production runs, forecasts,
calendar, todos, notes, wholesale, stylists, alerts, money, loose po lines,
style, muse), `query_status`, `read_file`, `open_email`.

**Budget.** 8,000 tokens for a normal turn. Before sending, a 14,000-character
cap drops the lowest-priority sections first and says which (this text
tokenises at about 1.75 characters a token, from the 13 Oct live-tail
measurement). On real data on 16 Oct the state is 9,700 characters with no
records named and 13,800 with two. The size that counts is measured: the
state is the only uncached part of the request, so the API's own
`input_tokens` is its token size.

**Safety.** Framed as reference data read by the app, never instructions; free
text inside cannot open or close the frame. What may appear is decided
(`transientSelection`) before any data is rendered. Every stock, PO, money,
practice and approval guard lives in the tools and runs exactly as before:
this layout changes what Mouse is shown, not what a tool does.

**History window.** It now moves in steps of ten (11–20 messages, start at a
multiple of 10 in the thread), so its start holds for five exchanges instead
of moving every turn (10 of 36 threads in the two weeks to 16 Oct were longer
than the old 20-message window). Transient layout only.

## Measurements, per request

On every `RequestUsage` (saved with each chat reply in `agentUsageJson`):
`requestNumber`, `toolRounds` (finished before this request),
`fullRecordFetches` (open_record, query_status, read_file, open_email so
far), `transientChars`, `transientTokens` (the API's uncached input), and
`transientTrimmed` when the cap dropped anything; plus cache reads and
writes, as before.

## Acceptance (not yet met: needs the paid run)

`scripts/transient-bakeoff.ts`: the same 13 practice turns in both layouts,
real Opus answers, interleaved, record churn scheduled at production's rate,
usage recorded under `transient-bakeoff`. Roughly $8–12. Needs
`ANTHROPIC_API_KEY` and database access; refuses without the key.

Turns: time zone, stock count, stock write, stock-pause warning, PO receipt,
cash (finance rule), friends-and-family price (Shopify works out money, never
Mouse), never size an order (for a person to judge), files (the W-9), email
lookup (Calamo, 3103), product notes (Story Dress lining), to-do awareness,
multi-round (overdue POs).

Claims, judged in `scripts/transient-bakeoff-checks.ts` (tested):

1. safety: no write ran in either layout
2. quality: transient fails no automatic check that live-tail passes, and
   every turn finished in both
3. size: the measured state averages 8,000 tokens or less on normal turns
4. cache writes: transient at most 50% of live-tail on the same turns
5. cost: production's completed-chat cost under live-tail, scaled by the
   replay's real cost ratio, about $0.30 or below

A plumbing run against a local fake API (`BAKEOFF_DRY_RUN=1`) exercised every
turn, measurement and claim with fake numbers. It proves the harness, not the
layout.

## Open points for review

- There is no per-person finance restriction in the code; "finance" turns test
  the money rules (cash age, Shopify works out prices). `transientSelection`
  is where a restriction would go.
- A change to the stable core (a product, variant, colourway or component
  added, renamed or retired) rewrites the core and, behind it, the cached
  history: about 15,000 tokens. Rare, but measured nowhere yet.
- A whole-section fetch is large (products 18.7k characters, notes 20.6k);
  the rules steer Mouse to single records first.
- The state is rebuilt per request with about 16 queries in one batch (about
  0.6–0.8 s from here); a turn with many tool rounds pays that each time.
