CREATE TABLE timelines (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 parent_id TEXT REFERENCES timelines(id), parent_save_id TEXT,
 name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 clock TEXT NOT NULL, settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
 created_at TEXT NOT NULL, archived_at TEXT, UNIQUE(id,campaign_id)
) STRICT;
CREATE TABLE game_entities (
 timeline_id TEXT NOT NULL REFERENCES timelines(id), id TEXT NOT NULL,
 kind TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), revision INTEGER NOT NULL DEFAULT 1,
 source_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
 PRIMARY KEY(timeline_id,id)
) STRICT;
CREATE TABLE entity_links (
 timeline_id TEXT NOT NULL, entity_id TEXT NOT NULL, target_id TEXT NOT NULL,
 PRIMARY KEY(timeline_id,entity_id,target_id),
 FOREIGN KEY(timeline_id,entity_id) REFERENCES game_entities(timeline_id,id),
 FOREIGN KEY(timeline_id,target_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE TABLE world_facts (
 timeline_id TEXT NOT NULL REFERENCES timelines(id), id TEXT NOT NULL,
 subject_id TEXT NOT NULL, predicate TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 source_event_id TEXT NOT NULL, created_at TEXT NOT NULL, retired_at TEXT,
 PRIMARY KEY(timeline_id,id), FOREIGN KEY(timeline_id,subject_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE TABLE character_knowledge (
 timeline_id TEXT NOT NULL, observer_id TEXT NOT NULL, fact_id TEXT NOT NULL,
 source TEXT NOT NULL, learned_at TEXT NOT NULL,
 PRIMARY KEY(timeline_id,observer_id,fact_id),
 FOREIGN KEY(timeline_id,observer_id) REFERENCES game_entities(timeline_id,id),
 FOREIGN KEY(timeline_id,fact_id) REFERENCES world_facts(timeline_id,id)
) STRICT;
CREATE TABLE character_beliefs (
 timeline_id TEXT NOT NULL, id TEXT NOT NULL, observer_id TEXT NOT NULL,
 proposition TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 source TEXT NOT NULL, updated_at TEXT NOT NULL, corrected_by TEXT,
 PRIMARY KEY(timeline_id,id), FOREIGN KEY(timeline_id,observer_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE TABLE character_memories (
 timeline_id TEXT NOT NULL, id TEXT NOT NULL, observer_id TEXT NOT NULL,
 text TEXT NOT NULL, salience REAL NOT NULL CHECK(salience BETWEEN 0 AND 1),
 decay_per_day REAL NOT NULL CHECK(decay_per_day BETWEEN 0 AND 1),
 source_event_id TEXT NOT NULL, created_at TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(timeline_id,id), FOREIGN KEY(timeline_id,observer_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE TABLE game_events (
 id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL REFERENCES timelines(id), revision INTEGER NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id), character_id TEXT, type TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)), effects_json TEXT NOT NULL CHECK(json_valid(effects_json)),
 seed TEXT NOT NULL, rng_draws INTEGER NOT NULL, clock TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(timeline_id,revision)
) STRICT;
CREATE TABLE story_turns (
 id TEXT PRIMARY KEY REFERENCES game_events(id), timeline_id TEXT NOT NULL REFERENCES timelines(id),
 user_id TEXT NOT NULL REFERENCES users(id), character_id TEXT NOT NULL,
 input_text TEXT NOT NULL, permitted_json TEXT NOT NULL CHECK(json_valid(permitted_json)),
 narration TEXT NOT NULL, narration_status TEXT NOT NULL, prompt_version TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE game_receipts (
 timeline_id TEXT NOT NULL REFERENCES timelines(id), actor_id TEXT NOT NULL REFERENCES users(id),
 key TEXT NOT NULL, body_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 PRIMARY KEY(timeline_id,actor_id,key)
) STRICT;
CREATE TABLE saves (
 id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL REFERENCES timelines(id), name TEXT NOT NULL,
 revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 checksum TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 automatic INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE creator_templates (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL,
 bundle_json TEXT NOT NULL CHECK(json_valid(bundle_json)), revision INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, archived_at TEXT
) STRICT;
CREATE TABLE ai_usage (
 id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL REFERENCES timelines(id), user_id TEXT NOT NULL REFERENCES users(id),
 turn_id TEXT NOT NULL REFERENCES story_turns(id), provider TEXT NOT NULL,
 reserved_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX entities_kind ON game_entities(timeline_id,kind,archived_at);
CREATE INDEX knowledge_observer ON character_knowledge(timeline_id,observer_id);
CREATE INDEX turns_observer ON story_turns(timeline_id,character_id,created_at);
CREATE INDEX saves_timeline ON saves(timeline_id,revision);
CREATE TRIGGER game_events_immutable_update BEFORE UPDATE ON game_events BEGIN SELECT RAISE(ABORT,'immutable game event'); END;
CREATE TRIGGER game_events_immutable_delete BEFORE DELETE ON game_events BEGIN SELECT RAISE(ABORT,'immutable game event'); END;
CREATE TRIGGER saves_immutable_update BEFORE UPDATE ON saves BEGIN SELECT RAISE(ABORT,'immutable save'); END;
CREATE TRIGGER saves_immutable_delete BEFORE DELETE ON saves BEGIN SELECT RAISE(ABORT,'immutable save'); END;
CREATE TRIGGER game_receipts_immutable_update BEFORE UPDATE ON game_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER game_receipts_immutable_delete BEFORE DELETE ON game_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
