CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','creator','player')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 archived_at TEXT
) STRICT;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE worlds (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
) STRICT;
CREATE TABLE campaigns (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 source_world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL,
 starting_at TEXT NOT NULL, timezone TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
) STRICT;
CREATE TABLE memberships (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('admin','creator','player','observer')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(campaign_id,user_id)
) STRICT;
-- A reusable definition belongs to a world; an instance belongs to exactly one campaign.
CREATE TABLE records (
 id TEXT PRIMARY KEY, world_id TEXT REFERENCES worlds(id), campaign_id TEXT REFERENCES campaigns(id),
 source_record_id TEXT REFERENCES records(id), source_revision INTEGER,
 owner_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, name TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('creator','campaign','owner','knowledge')),
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id), archived_at TEXT,
 CHECK ((world_id IS NOT NULL) != (campaign_id IS NOT NULL)),
 CHECK ((source_record_id IS NULL) = (source_revision IS NULL))
) STRICT;
CREATE TABLE sections (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), parent_id TEXT,
 name TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
 visibility TEXT NOT NULL CHECK(visibility IN ('creator','campaign','owner','knowledge')),
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 archived_at TEXT, UNIQUE(id,record_id),
 FOREIGN KEY(parent_id,record_id) REFERENCES sections(id,record_id)
) STRICT;
CREATE TABLE fields (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), section_id TEXT NOT NULL,
 name TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
 value_type TEXT NOT NULL CHECK(value_type IN ('text','number','boolean','json')),
 visibility TEXT NOT NULL CHECK(visibility IN ('creator','campaign','owner','knowledge')),
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
 UNIQUE(id,record_id), FOREIGN KEY(section_id,record_id) REFERENCES sections(id,record_id)
) STRICT;
CREATE TABLE field_values (
 field_id TEXT PRIMARY KEY REFERENCES fields(id), value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id)
) STRICT;
-- This is an access grant, NOT character knowledge/truth/belief/memory (System 04).
CREATE TABLE visibility_grants (
 record_id TEXT NOT NULL REFERENCES records(id), user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, granted_by TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(record_id,user_id)
) STRICT;
CREATE TABLE domain_events (
 id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=1),
 world_id TEXT REFERENCES worlds(id), campaign_id TEXT REFERENCES campaigns(id),
 actor_id TEXT NOT NULL REFERENCES users(id), aggregate_id TEXT NOT NULL,
 aggregate_revision INTEGER NOT NULL, type TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), seed TEXT NOT NULL,
 rng_version TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(aggregate_id,aggregate_revision)
) STRICT;
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), world_id TEXT REFERENCES worlds(id),
 campaign_id TEXT REFERENCES campaigns(id), action TEXT NOT NULL, target_id TEXT NOT NULL,
 event_id TEXT REFERENCES domain_events(id), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE command_receipts (
 scope_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
 request_hash TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 event_id TEXT NOT NULL REFERENCES domain_events(id), created_at TEXT NOT NULL,
 PRIMARY KEY(scope_id,actor_id,key)
) STRICT;
-- Durable outbox; consumers must deduplicate by event_id. Never send raw events to players.
CREATE TABLE outbox (
 event_id TEXT PRIMARY KEY REFERENCES domain_events(id),
 attempts INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE rate_limits (
 bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, hits INTEGER NOT NULL
) STRICT;
CREATE TRIGGER events_no_update BEFORE UPDATE ON domain_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON domain_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER audits_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER audits_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON command_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON command_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
