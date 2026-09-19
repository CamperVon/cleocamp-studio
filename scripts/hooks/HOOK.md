# Stopping the nightly Routine's permission prompts

The nightly QuickBooks Routine fires into a brand-new container. It carries no
memory of last night's approvals, so it stops and asks for every tool it touches
— five prompts, and until someone taps them the figures never get mailed.

A committed `.claude/settings.json` travels with the repo into each of those
containers, which is why the fix belongs here and not in `/permissions` on
somebody's laptop.

**A Claude session cannot write this file.** The harness blocks an agent from
editing the file that governs what that agent may do, and no instruction in chat
clears that block. Paste it by hand:

```json
{
  "permissions": {
    "allow": [
      "mcp__Intuit_QuickBooks__company_info",
      "mcp__Intuit_QuickBooks__profit_loss_quickbooks_account",
      "mcp__Intuit_QuickBooks__qbo_accounting_get_ar_aging_summary",
      "mcp__Intuit_QuickBooks__qbo_accounting_get_ar_aging_detail"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__Resend__send-email",
        "hooks": [
          { "type": "command", "command": "scripts/hooks/resend-guard.sh" }
        ]
      }
    ]
  }
}
```

The four QuickBooks entries are reads and go in the allow list as themselves.

Resend deliberately does NOT. An `allow` rule matches the tool and never its
arguments, so allowing `mcp__Resend__send-email` would grant "may email anyone",
when what the Routine needs is "may mail the figures to Mouse". The `PreToolUse`
hook reads the arguments an allow rule can't see and decides per call: silent for
`mouse@send.cleocamp.com` alone, a prompt for anything else. See the header of
`resend-guard.sh` for why it answers "ask" rather than "deny", and why cc and bcc
are checked too.

Net effect: zero prompts on a normal night, one prompt the moment a send is
pointed anywhere else.

## After pasting

Claude Code only watches directories that held a settings file when the session
started. `.claude/` did not, so an already-running session won't pick this up —
open `/hooks` once, or start a fresh session. The Routine's next firing gets it
either way, since that container starts from the committed repo.

Check it parses and the matcher is found:

```
jq -e '.hooks.PreToolUse[] | select(.matcher == "mcp__Resend__send-email") | .hooks[].command' .claude/settings.json
```

Exit 0 and it prints the script path. Exit 5 means malformed JSON, which silently
disables *every* setting in the file, allow list included.
