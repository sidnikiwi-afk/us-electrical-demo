# Approved implementation model plan

Recorded 12 October 2026 from Saeed's model-selection discussion. Saeed approved this routing with FLOOR-ZONES-IMPLEMENTATION-PLAN.md on 12 October 2026, reply "I approve." Spec and tickets are being prepared; publication remains excluded. No workers were dispatched and no live availability admission was performed.

| Role | Model and effort | Work |
| --- | --- | --- |
| Controller | GPT-6.1 Sol, medium, current subscription session | Scope, packets, integration, evidence, PR and authorised release gates |
| Main implementer | Grok 4.7, medium, direct grok CLI with grok.com login | Bounded implementation tickets, focused tests and fixes, including UI implementation |
| UI guidance and review | Opus 5.5, medium, Claude subscription through visible Herdr/Office workflow | Clarify approved design before build; inspect implemented desktop/tablet/phone and print views against design and spec; return anchored findings |
| Independent Standards/Spec reviewer | GLM 5.3, medium, glm53 subscription route | Small read-only lane under roster v1.3; Grok cannot independently review its own build |
| Required PR review | Independent subscription-backed Codex review | Pin current PR head/base; record findings and coverage; resolve blocking issues and recheck head before merge |
| Difficult technical consultation | GPT-6 Astra, medium, Codex subscription | One named unresolved architecture/debugging question, read-only |
| Difficult design consultation | Fable 5.1, medium, Cursor exact claude-fable-5-1-medium binding | One named unresolved question, read-only, only after allowance and live admission pass |

Grok as main implementer is Saeed's project-specific requested routing, extending the roster's default role assignment for this workstream. Preserve exact model and medium effort; do not substitute. Opus 5.5 uses the already selected project subscription route, rather than silently changing to the roster's Opus 5 Cursor binding. Resolve runtime identifiers, helper paths and authentication at admission before any dispatch. Office agent is first-choice worker host; controller stays here. No paid API route is authorised.

Suggested sequence: approved spec/tickets -> bounded Opus UI implementation guidance -> Grok implementation slices -> controller-run verification -> Opus visual review plus independent Standards/Spec review -> Grok corrections -> exact-head Codex PR review -> existing CI/merge/deployment/smoke gates. Consult only when evidence exposes a named hard question. Model selection does not authorize implementation or publication.

Design references: FLOOR-PLAN-DESIGN-STATUS.md and ../design-previews/floor-zones/DESIGN.md. Preserve existing saved jobs, private notes and original pricing workbook. No raw customer messages, secrets or production data in worker packets.
