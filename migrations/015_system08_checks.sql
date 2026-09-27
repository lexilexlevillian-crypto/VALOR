CREATE TABLE check_records (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES game_events(id),
 character_id TEXT NOT NULL,
 check_definition_id TEXT,
 attribute TEXT NOT NULL,
 skill_id TEXT,
 context TEXT NOT NULL DEFAULT '',
 difficulty REAL NOT NULL,
 die_value REAL,
 attribute_value REAL NOT NULL,
 skill_value REAL NOT NULL,
 total REAL,
 outcome TEXT NOT NULL CHECK(outcome IN ('critical','partial','success','success-at-cost','failure-with-information','failure-with-consequence','impossible','no-roll')),
 modifiers_json TEXT NOT NULL CHECK(json_valid(modifiers_json)),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(timeline_id,character_id) REFERENCES game_entities(timeline_id,id),
 FOREIGN KEY(timeline_id,check_definition_id) REFERENCES game_entities(timeline_id,id),
 FOREIGN KEY(timeline_id,skill_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
CREATE INDEX check_records_character ON check_records(timeline_id,character_id,created_at);
CREATE INDEX check_records_event ON check_records(event_id);
CREATE TRIGGER check_records_immutable_update BEFORE UPDATE ON check_records BEGIN SELECT RAISE(ABORT,'immutable check record'); END;
CREATE TRIGGER check_records_immutable_delete BEFORE DELETE ON check_records BEGIN SELECT RAISE(ABORT,'immutable check record'); END;
