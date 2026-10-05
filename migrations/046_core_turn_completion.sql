CREATE TABLE turn_scenes (id TEXT PRIMARY KEY,timeline_id TEXT NOT NULL REFERENCES timelines(id),character_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('OPEN','SUSPENDED','CLOSED')),state_json TEXT NOT NULL);
CREATE INDEX turn_scene_scope ON turn_scenes(timeline_id,character_id,status);
CREATE TABLE turn_attempt_records (command_id TEXT PRIMARY KEY REFERENCES turn_interactions(command_id),record_json TEXT NOT NULL);
CREATE TRIGGER turn_attempt_immutable_update BEFORE UPDATE ON turn_attempt_records BEGIN SELECT RAISE(ABORT,'immutable_turn_attempt'); END;
CREATE TRIGGER turn_attempt_immutable_delete BEFORE DELETE ON turn_attempt_records BEGIN SELECT RAISE(ABORT,'immutable_turn_attempt'); END;
