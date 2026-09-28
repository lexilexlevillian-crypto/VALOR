CREATE TABLE timeline_turn_cursors (
 timeline_id TEXT PRIMARY KEY REFERENCES timelines(id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 cursor TEXT NOT NULL UNIQUE CHECK(length(cursor) BETWEEN 16 AND 128),
 updated_at TEXT NOT NULL
) STRICT;

INSERT INTO timeline_turn_cursors(timeline_id,revision,cursor,updated_at)
SELECT id,revision,lower(hex(randomblob(16))),created_at FROM timelines;

CREATE TRIGGER timeline_turn_cursor_create AFTER INSERT ON timelines
BEGIN
 INSERT INTO timeline_turn_cursors(timeline_id,revision,cursor,updated_at)
 VALUES (NEW.id,NEW.revision,lower(hex(randomblob(16))),NEW.created_at);
END;

CREATE TABLE turn_traces (
 trace_id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
 original_text TEXT NOT NULL,
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=1),
 expected_cursor TEXT,
 event_id TEXT REFERENCES game_events(id),
 status TEXT NOT NULL CHECK(status IN ('running','committed','validated','fallback','failed','canceled')),
 failure_reason TEXT,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 UNIQUE(timeline_id,actor_id,request_key)
) STRICT;

CREATE TABLE turn_trace_steps (
 trace_id TEXT NOT NULL REFERENCES turn_traces(trace_id),
 sequence INTEGER NOT NULL CHECK(sequence>=1),
 stage TEXT NOT NULL,
 duration_ms REAL NOT NULL CHECK(duration_ms>=0),
 status TEXT NOT NULL CHECK(status IN ('succeeded','failed','replayed','fallback','canceled')),
 failure_reason TEXT,
 details_json TEXT NOT NULL CHECK(json_valid(details_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(trace_id,sequence)
) STRICT;

CREATE INDEX turn_traces_timeline_created ON turn_traces(timeline_id,created_at);
CREATE INDEX turn_traces_event ON turn_traces(event_id);

CREATE TRIGGER turn_trace_steps_immutable_update BEFORE UPDATE ON turn_trace_steps
BEGIN SELECT RAISE(ABORT,'immutable turn trace step'); END;
CREATE TRIGGER turn_trace_steps_immutable_delete BEFORE DELETE ON turn_trace_steps
BEGIN SELECT RAISE(ABORT,'immutable turn trace step'); END;
