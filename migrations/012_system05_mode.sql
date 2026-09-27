-- System 05: persisted Player/Developer mode preference.
-- This is an account UI preference, not a security grant. Server role checks remain authoritative.
CREATE TABLE user_mode_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 mode TEXT NOT NULL DEFAULT 'player' CHECK(mode IN ('player','developer')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;

INSERT INTO user_mode_preferences(user_id,mode,revision,created_at,updated_at)
SELECT id,'player',1,created_at,updated_at FROM users;

CREATE INDEX user_mode_preferences_revision ON user_mode_preferences(user_id,revision);
