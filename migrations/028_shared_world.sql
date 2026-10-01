-- One authoring source, isolated campaign/timeline per player life.
CREATE TABLE shared_world (
 id INTEGER PRIMARY KEY CHECK(id=1),
 timeline_id TEXT NOT NULL UNIQUE REFERENCES timelines(id),
 owner_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE player_lives (
 campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 source_timeline_id TEXT NOT NULL REFERENCES timelines(id),
 source_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX player_lives_user ON player_lives(user_id);
CREATE TABLE life_entry_receipts (
 user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 PRIMARY KEY(user_id,request_key)
) STRICT;
