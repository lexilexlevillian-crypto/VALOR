# SYSTEM 11 — Provider-Agnostic AI Gateway and Tool Contracts

Status: implemented and tested.

## Adapter and request contract

All external model calls now cross `AiGateway` with a server-created, schema-validated envelope. A request cannot be constructed without:

- `purpose`: `narration`, `extraction`, `classification`, or optional `creator-assistance`;
- provider, model, and configuration identity;
- input, output, total-token, per-attempt timeout, and attempt-count budgets;
- an explicit allowlist drawn from the four narrow tool names;
- a named/versioned JSON response contract and SHA-256 schema digest;
- a named/versioned server prompt;
- source, trust, privacy, and revision provenance for every context entry;
- a UUID trace ID, queue time, and explicit cache policy.

`AiProviderAdapter.complete(request, signal)` is the provider-neutral boundary. It must return the same trace ID, an output value, nonnegative input/output usage, and a bounded tool-call list. The HTTPS adapter requires an HTTPS credential-free URL, keeps the bearer credential in a header, forbids redirects, caps responses at 64 KiB, and validates the complete envelope. Gemini implements the same adapter while retaining its compatibility methods; other providers can be added without changing game authorization or validation.

Model routing is purpose-specific. Gemini supports independent `GEMINI_NARRATION_MODEL`, `GEMINI_CLASSIFICATION_MODEL`, `GEMINI_EXTRACTION_MODEL`, and `GEMINI_CREATOR_MODEL` settings, each with a distinct configuration identity even when deployments choose the same underlying model. Creator assistance remains optional and has no route that commits canon.

## Validation and trust boundary

Lore, player input, NPC text, and Creator-authored text are labeled untrusted data. The fixed instruction boundary states that this content cannot alter system instructions, grant authority, expand tools, or execute commands. Context text is never interpreted as configuration. Provider output is parsed strictly, its trace and usage are checked, every tool call is authorized, and the purpose-specific result validator runs before a result can reach game code.

The only tool contracts are:

- `factual.lookup`: returns prefiltered facts from server-issued opaque IDs;
- `interpretation.propose`: selects a server-issued candidate and always requires confirmation;
- `narration.compose`: references only server-issued simulation fragment IDs;
- `server-command.propose`: selects a pre-authorized opaque candidate at an exact revision and returns a proposal requiring confirmation.

There is no database, SQL, filesystem, shell, arbitrary write, or web tool. A command proposal never executes inside the AI gateway. Normal server authorization, input validation, optimistic revision checks, and explicit confirmation remain required at the later command boundary. Model narration cannot author canon or mechanics.

## Queue, timeout, retry, streaming, and fallback policy

The in-process gateway permits four active calls and 32 queued calls by default. Queue wait is capped at two seconds; excess work fails predictably. Each game request permits at most two 12-second attempts. Cancellation races independently of provider cooperation. Provider streaming is exposed only as a validated terminal result: partial provider JSON is withheld, preserving the existing atomic Chronicle commit rule.

Malformed output, unauthorized tools, trace mismatch, excessive usage, timeout, queue rejection, and provider outage fail closed. Narration retains the previously committed grounded prose. Interpretation tells the player to use explicit action controls and confirms that nothing happened. Creator assistance states that no changes were made. Extraction leaves its source unchanged. Fallback output is local, schema-validated, costs no provider tokens, and cannot mutate simulation.

## Cost, cache, and audit safeguards

Campaign and per-user reservations remain in force before narration or classification starts. Reservations conservatively cover configured attempts. The gateway separately rejects provider-reported usage above the request's input, output, or total cap. Output token caps are supplied to provider adapters; response bytes are bounded independently.

Caching is opt-in and allowed only for reproducible extraction/classification over public lore or server facts. Narration, Creator assistance, private/campaign data, player input, NPC text, and command proposals cannot be cached. Cache keys include purpose, model/configuration, prompt/version, response schema, and full context digest. Personalized/private narration is therefore never reused across players.

Migration 022 adds `ai_requests`. It records trace, purpose, model/configuration, budgets, allowed tools, response schema identity/digest, prompt identity/version, context provenance digests, cache policy, attempts, usage, status, and failure code. Raw prompts, story context, player input, NPC text, credentials, and provider responses are not logged. Existing campaign/user usage ledgers remain the billing reservation authority.

## Verification

Focused tests cover mandatory request fields, separate routes, untrusted lore enforcement, prompt injection, malformed and unauthorized tool output, command authorization, over-budget usage, provider outage and retry, redacted logging, graceful fallback, cache exclusion, queue rejection, and validated streaming. Existing Gemini, game, lifecycle, and Chronicle tests cover credential handling, provider errors, shared budgets, invalid candidate selection, simulation immutability, and cancellation of a non-cooperative provider.
