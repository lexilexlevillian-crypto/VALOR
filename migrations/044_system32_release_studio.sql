-- System 32: durable Creator production workflow, confirmed Developer operations, and operational telemetry.
CREATE TABLE creator_content_drafts (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 entity_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
 base_entity_revision INTEGER,
 version INTEGER NOT NULL CHECK(version>0),
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 published_event_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE creator_content_versions (
 draft_id TEXT NOT NULL REFERENCES creator_content_drafts(id),
 version INTEGER NOT NULL CHECK(version>0),
 action TEXT NOT NULL CHECK(action IN ('drafted','published','restored','archived','duplicated','template-instantiated')),
 entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
 validation_json TEXT NOT NULL CHECK(json_valid(validation_json)),
 reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(draft_id,version)
) STRICT;

CREATE TABLE creator_content_templates (
 id TEXT PRIMARY KEY,
 world_id TEXT NOT NULL REFERENCES worlds(id),
 name TEXT NOT NULL,
 kind TEXT NOT NULL,
 entity_json TEXT NOT NULL CHECK(json_valid(entity_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE developer_operation_previews (
 token TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 operation TEXT NOT NULL CHECK(operation IN ('fixture','repair')),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 plan_checksum TEXT NOT NULL CHECK(length(plan_checksum)=64),
 state_checksum TEXT NOT NULL CHECK(length(state_checksum)=64),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>0),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
) STRICT;

CREATE TABLE developer_repair_records (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 operation TEXT NOT NULL,
 preview_token TEXT NOT NULL REFERENCES developer_operation_previews(token),
 before_checksum TEXT NOT NULL CHECK(length(before_checksum)=64),
 after_checksum TEXT NOT NULL CHECK(length(after_checksum)=64),
 report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 event_id TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
) STRICT;

CREATE TABLE operational_metric_events (
 id INTEGER PRIMARY KEY,
 campaign_id TEXT REFERENCES campaigns(id),
 timeline_id TEXT REFERENCES timelines(id),
 metric TEXT NOT NULL CHECK(metric IN ('api_latency_ms','api_error','turn_latency_ms','save_failure','migration_failure','simulation_latency_ms')),
 value REAL NOT NULL,
 status TEXT NOT NULL,
 dimensions_json TEXT NOT NULL CHECK(json_valid(dimensions_json)),
 created_at TEXT NOT NULL
) STRICT;

CREATE INDEX creator_content_drafts_search ON creator_content_drafts(timeline_id,status,kind,name);
CREATE INDEX creator_content_versions_history ON creator_content_versions(draft_id,version DESC);
CREATE UNIQUE INDEX creator_content_templates_name ON creator_content_templates(world_id,name) WHERE status='active';
CREATE INDEX developer_operation_actor ON developer_operation_previews(timeline_id,actor_id,expires_at);
CREATE INDEX developer_repairs_timeline ON developer_repair_records(timeline_id,created_at);
CREATE INDEX operational_metrics_time ON operational_metric_events(metric,created_at);
CREATE INDEX operational_metrics_timeline ON operational_metric_events(timeline_id,created_at);

CREATE TRIGGER creator_content_versions_no_update BEFORE UPDATE ON creator_content_versions BEGIN SELECT RAISE(ABORT,'immutable creator content version'); END;
CREATE TRIGGER creator_content_versions_no_delete BEFORE DELETE ON creator_content_versions BEGIN SELECT RAISE(ABORT,'immutable creator content version'); END;
CREATE TRIGGER developer_repairs_no_update BEFORE UPDATE ON developer_repair_records BEGIN SELECT RAISE(ABORT,'immutable developer repair'); END;
CREATE TRIGGER developer_repairs_no_delete BEFORE DELETE ON developer_repair_records BEGIN SELECT RAISE(ABORT,'immutable developer repair'); END;
