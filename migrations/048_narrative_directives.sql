-- Private presentation metadata; never simulation facts or NPC memory.
CREATE TABLE narrative_directives (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 character_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('GAME','STORY')),
 scope TEXT NOT NULL CHECK(scope IN ('one-response','scene')),
 scene_id TEXT,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 consumed_event_id TEXT REFERENCES game_events(id)
);
CREATE INDEX narrative_directives_active ON narrative_directives(timeline_id,user_id,character_id,mode,consumed_event_id);
