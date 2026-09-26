CREATE TABLE ai_intent_usage (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL,
 reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=0),
 status TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX intent_usage_campaign_user ON ai_intent_usage(timeline_id,user_id);
