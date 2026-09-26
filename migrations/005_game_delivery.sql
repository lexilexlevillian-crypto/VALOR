-- Durable delivery is separate from player-facing, observer-filtered narration.
CREATE TABLE game_outbox (
 event_id TEXT PRIMARY KEY REFERENCES game_events(id),
 created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until TEXT, delivered_at TEXT
) STRICT;
CREATE INDEX game_outbox_pending ON game_outbox(delivered_at,lease_until,created_at);
