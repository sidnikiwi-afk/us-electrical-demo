# Approved implementation model plan

Recorded 12 October 2026 from Saeed's model-selection discussion. Saeed approved the routing with FLOOR-ZONES-IMPLEMENTATION-PLAN.md on 12 October 2026, reply "I approve." Spec and tickets are being prepared; publication remains excluded. No workers were dispatched and no live availability admission was performed.

## Model routing

Approved by Saeed, 2026-10-17. The full roster is the canonical Model Roster v1.4 in the Universal Prompt Library; if this section and the roster disagree, the roster wins.

- Orchestrator: Opus 5.5 (`claude-opus-5-5`).
- Heavy building, coding and reviewing: Grok 4.7 (`grok -m grok-4.7 --effort medium`; high for named hard tasks).
- Long reads: Grok 4.6 medium (`grok -m grok-4.6 --effort medium`), a cheaper, faster lane with the same 256k window as Grok 4.7.
- Fast or quick tasks: GLM 5.3 Flash (`glm53flash --permission-mode auto --effort low`); when it is down, Cursor Composer (`cursor-agent --model composer-2.5`).
- PR reviews: GPT 6.1 Sol (`codex -m gpt-6.1-sol`, medium; ultra for security, tenancy, migration or billing PRs); fallback Grok 4.7 medium (`grok -m grok-4.7 --effort medium`).
- Start a fresh session at about 50% of the context window or after 2 compactions.

Real work runs in Herdr tabs; Grok Bot only routes, relays and reports. Product model pins (Retell voices, app LLM calls, Workers AI bindings) are separate and stay as they are.

Project release gates are stricter and stay: `docs/ZONES-RELEASE.md` keeps its own required reviews (Opus 5.5 design review, GLM 5.3 Standards/Spec review, subscription Codex review).

Saeed approved an earlier table on 2026-10-12. The 2026-10-17 policy replaces it. Resolve runtime identifiers, helper paths and authentication at admission before any dispatch. Office agent is first-choice worker host; controller stays here. No paid API route is authorised.

Suggested sequence: approved spec/tickets -> bounded UI guidance -> Grok implementation slices -> controller-run verification -> visual review plus independent Standards/Spec review -> Grok corrections -> exact-head PR review (`codex -m gpt-6.1-sol`) -> existing CI/merge/deployment/smoke gates. Consult only when evidence exposes a named hard question. Model selection does not authorize implementation or publication.

Design references: FLOOR-PLAN-DESIGN-STATUS.md and ../design-previews/floor-zones/DESIGN.md. Preserve existing saved jobs, private notes and original pricing workbook. No raw customer messages, secrets or production data in worker packets.
