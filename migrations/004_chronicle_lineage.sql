CREATE TABLE archived_chronicle (
 timeline_id TEXT NOT NULL REFERENCES timelines(id), id TEXT NOT NULL,
 character_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 input_text TEXT NOT NULL, narration TEXT NOT NULL, narration_status TEXT NOT NULL,
 created_at TEXT NOT NULL, source_event_id TEXT NOT NULL,
 PRIMARY KEY(timeline_id,id),
 FOREIGN KEY(timeline_id,character_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE TRIGGER archived_chronicle_no_update BEFORE UPDATE ON archived_chronicle BEGIN SELECT RAISE(ABORT,'immutable chronicle'); END;
CREATE TRIGGER archived_chronicle_no_delete BEFORE DELETE ON archived_chronicle BEGIN SELECT RAISE(ABORT,'immutable chronicle'); END;
