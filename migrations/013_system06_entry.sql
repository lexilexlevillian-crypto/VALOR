CREATE TABLE campaign_start_packages (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 slug TEXT NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN ('guided','freeform','template')),
 visibility TEXT NOT NULL CHECK(visibility IN ('creator','campaign')),
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 schema_version INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 archived_at TEXT,
 UNIQUE(campaign_id,slug)
) STRICT;
CREATE INDEX campaign_start_packages_visible ON campaign_start_packages(campaign_id,status,visibility,archived_at);
CREATE TRIGGER campaign_start_packages_no_delete BEFORE DELETE ON campaign_start_packages BEGIN SELECT RAISE(ABORT,'archive_start_package'); END;