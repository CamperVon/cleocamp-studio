#!/usr/bin/env bash
#
# Scope a Claude session's outbound mail to the Mouse inbox.
#
# WHY THIS EXISTS. The nightly QuickBooks Routine mails its figures to
# mouse@send.cleocamp.com, and each firing starts in a fresh container that
# remembers no approval, so it stops and asks. Allowing the Resend tool outright
# clears the prompt but grants far more than the Routine needs: a permission
# `allow` rule matches the TOOL, never its arguments, so "may send the nightly
# figures to Mouse" and "may email anyone at all" are the same rule. There is no
# "everything except" form to write instead.
#
# A PreToolUse hook can read the arguments, which an allow rule cannot. So the
# allow list stays off the Resend tool, and this decides per call: silent for the
# one address the Routine needs, a prompt for everything else.
#
# It answers "ask", never "deny" — a real send to Brandon or a vendor from a chat
# session still goes through, it just costs a tap. Refusing outright would break
# ordinary work to fix a cron job.
#
# cc and bcc must both be empty. Checking only `to` would wave through the exact
# shape that caused the trouble on 16 Sept 2026, when internal commentary reached
# Antonio's copy of PO 2360 — right primary recipient, wrong second one.
#
# CLAUDE.md §6: there is no staging Resend key. Anything that sends, sends.
#
# Wire it up in .claude/settings.json (see HOOK.md), then test with:
#   echo '{"tool_input":{"to":["mouse@send.cleocamp.com"]}}' | scripts/hooks/resend-guard.sh
set -uo pipefail

MOUSE="mouse@send.cleocamp.com"

# No jq, no opinion. Falling back to "ask" keeps a broken toolchain from
# silently becoming a broader permission than anyone agreed to.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"resend-guard could not run (jq missing) — confirm this send by hand."}}'
  exit 0
fi

jq -c --arg mouse "$MOUSE" '
  # `to` arrives as a bare string or an array depending on the caller. Absent
  # keys must read as empty, not null, or the length checks below throw.
  def norm: if . == null then [] elif type == "array" then . else [.] end;

  (.tool_input.to  | norm) as $to  |
  (.tool_input.cc  | norm) as $cc  |
  (.tool_input.bcc | norm) as $bcc |

  # Exactly one recipient, exactly that address. `contains` would pass a send
  # addressed to Mouse AND six other people.
  (($to | length) == 1
    and $to[0] == $mouse
    and ($cc  | length) == 0
    and ($bcc | length) == 0) as $ok |

  { hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: (if $ok then "allow" else "ask" end),
      permissionDecisionReason: (if $ok
        then "Nightly figures to the Mouse inbox."
        else "Recipient is not the Mouse inbox (to=\($to), cc=\($cc), bcc=\($bcc)). Confirm before this sends."
        end) } }'
