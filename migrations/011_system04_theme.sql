-- System 04: durable user theme preferences and Creator campaign palette policy.
CREATE TABLE user_theme_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 theme_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

INSERT INTO user_theme_preferences(user_id,theme_id,revision,created_at,updated_at)
SELECT id,'neon-green-terminal',1,created_at,updated_at FROM users;

CREATE TABLE campaign_theme_settings (
 campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
 recommended_theme_id TEXT NOT NULL,
 allowed_themes_json TEXT NOT NULL CHECK(json_valid(allowed_themes_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT REFERENCES users(id)
) STRICT;

INSERT INTO campaign_theme_settings(campaign_id,recommended_theme_id,allowed_themes_json,revision,created_at,updated_at,updated_by)
SELECT id,'neon-green-terminal',
 '["neon-green-terminal","neon-pink-scene","neon-purple-night","neon-blue-electric","neon-red-heat","neon-amber","neon-cyan","neon-white-chrome","soft-baby-pink","soft-baby-blue","soft-butter-yellow"]',
 1,created_at,updated_at,owner_id FROM campaigns;

CREATE INDEX user_theme_preferences_revision ON user_theme_preferences(user_id,revision);
CREATE INDEX campaign_theme_settings_revision ON campaign_theme_settings(campaign_id,revision);


INSERT OR IGNORE INTO artifact_schema_versions
 (artifact_type,artifact_id,scope_type,scope_id,schema_version,created_at)
SELECT 'campaign_theme_setting',campaign_id,'campaign',campaign_id,1,created_at
FROM campaign_theme_settings;

CREATE TRIGGER artifact_schema_campaign_theme_insert AFTER INSERT ON campaign_theme_settings BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions
 VALUES ('campaign_theme_setting',NEW.campaign_id,'campaign',NEW.campaign_id,1,NEW.created_at);
END;
