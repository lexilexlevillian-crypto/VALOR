-- System 1 (2026 master specification) adapts the existing System 13 timeline.
-- Preferences and pending input are interaction metadata, never a second world state.
CREATE TABLE turn_interactions (
 command_id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 character_id TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 kind TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX turn_interactions_scope ON turn_interactions(timeline_id,user_id,character_id);
CREATE TRIGGER turn_interactions_immutable_update BEFORE UPDATE ON turn_interactions BEGIN SELECT RAISE(ABORT,'immutable_turn_interaction'); END;
CREATE TRIGGER turn_interactions_immutable_delete BEFORE DELETE ON turn_interactions BEGIN SELECT RAISE(ABORT,'immutable_turn_interaction'); END;
CREATE TABLE turn_input_state (
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 character_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('GAME','STORY')),
 pending_json TEXT,
 PRIMARY KEY(timeline_id,user_id,character_id)
);
CREATE TABLE turn_narrative_contexts (
 event_id TEXT PRIMARY KEY REFERENCES game_events(id),
 context_json TEXT NOT NULL
);
CREATE TRIGGER turn_context_immutable_update BEFORE UPDATE ON turn_narrative_contexts BEGIN SELECT RAISE(ABORT,'immutable_turn_context'); END;
CREATE TRIGGER turn_context_immutable_delete BEFORE DELETE ON turn_narrative_contexts BEGIN SELECT RAISE(ABORT,'immutable_turn_context'); END;
CREATE TABLE turn_resolution_batches (
 event_id TEXT PRIMARY KEY REFERENCES game_events(id),
 batch_json TEXT NOT NULL
);
CREATE TRIGGER turn_batch_immutable_update BEFORE UPDATE ON turn_resolution_batches BEGIN SELECT RAISE(ABORT,'immutable_turn_batch'); END;
CREATE TRIGGER turn_batch_immutable_delete BEFORE DELETE ON turn_resolution_batches BEGIN SELECT RAISE(ABORT,'immutable_turn_batch'); END;

ALTER TABLE turn_traces ADD COLUMN rng_seed TEXT;
CREATE TABLE narration_versions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES game_events(id),narration TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER narration_version_immutable_update BEFORE UPDATE ON narration_versions BEGIN SELECT RAISE(ABORT,'immutable_narration_version'); END;
CREATE TRIGGER narration_version_immutable_delete BEFORE DELETE ON narration_versions BEGIN SELECT RAISE(ABORT,'immutable_narration_version'); END;
