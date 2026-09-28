CREATE TABLE ai_requests (
 trace_id TEXT PRIMARY KEY,
 purpose TEXT NOT NULL CHECK(purpose IN ('narration','extraction','classification','creator-assistance')),
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 configuration_id TEXT NOT NULL,
 budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
 allowed_tools_json TEXT NOT NULL CHECK(json_valid(allowed_tools_json)),
 response_schema_id TEXT NOT NULL,
 response_schema_version TEXT NOT NULL,
 response_schema_digest TEXT NOT NULL CHECK(length(response_schema_digest)=64),
 prompt_id TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 context_provenance_json TEXT NOT NULL CHECK(json_valid(context_provenance_json)),
 cache_policy TEXT NOT NULL CHECK(cache_policy IN ('none','reproducible')),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','cached','fallback','failed','canceled','timed-out','queue-rejected')),
 attempt_count INTEGER NOT NULL CHECK(attempt_count>=0 AND attempt_count<=3),
 input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),
 output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
 failure_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX ai_requests_purpose_created ON ai_requests(purpose,created_at);
CREATE INDEX ai_requests_provider_status ON ai_requests(provider,status,created_at);
