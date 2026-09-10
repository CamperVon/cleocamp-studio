# Studio Mouse workflow progress

September 10, 2026. Local checkout: `studio-mouse-build`, branch `codex/studio-workflows`.

## Implemented in this batch

- Clean PO exports from the document page and Mouse's export tool. Saved PDF bytes survive subsequent edits; identical requests reuse a copy. Exporting leaves order status, email and inventory unchanged.
- Existing English/Spanish document rendering verified with synthetic orders. Unknown prices display as unknown with a known subtotal; confirmed zero prices display zero. Fractional quantities round per line so displayed amounts sum correctly.
- Structured tool outcomes and per-request model token usage persisted for chat. Failed actions do not appear as completed writes. Model escalation preserves sibling actions and the same conversation. Request/output limits and provider failures preserve completed outcomes.
- Interrupted non-chat actions stop before closing their task; interrupted nightly analysis leaves mail unprocessed.
- Simpler Mouse voice and instructions for supported alternatives, language copies and error recovery.

## Verification

17 automated tests pass; TypeScript passes; targeted ESLint and git diff whitespace checks pass. Tests apply every migration to isolated in-memory Postgres and verify saved bytes, revision identity and unchanged order/email/inventory state. Actual English and Spanish PDFs were rendered and visually inspected. The production webpack build passes.

No live model, supplier send, Shopify write, production database migration or authenticated browser workflow was exercised. Translation fixtures verify rendering and commercial values, not live model translation quality. Model limits bound requests and output tokens, not total dollar spend.

## Release requirements

Apply `20260910190000_po_exports_and_agent_usage` before running the updated application and regenerate Prisma. Restart any dev server after migration. Validate the authenticated export flow against a separate test database before release. This checkout's `origin` points at the original local checkout. The `github` remote points at `CamperVon/cleocamp-studio`; use it to publish the feature branch.

## Remaining broader work

The full tee-run workflow is not complete. Durable production scenarios and sources, cross-conversation retrieval, deterministic cash-flow scenarios, Drive mapping/retrieval/writeback, and automated issue intake remain future implementation. Wholesale invoices remain in the backlog. The existing next-stage and Drive briefs describe their acceptance scenarios.

This batch is prepared for feature-branch review. Production migration and deployment remain outstanding.
