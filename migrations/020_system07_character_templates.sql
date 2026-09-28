CREATE TABLE character_profile_templates (
 id TEXT PRIMARY KEY,
 world_id TEXT NOT NULL REFERENCES worlds(id),
 name TEXT NOT NULL,
 template_json TEXT NOT NULL CHECK(json_valid(template_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 archived_at TEXT
) STRICT;
CREATE UNIQUE INDEX character_profile_templates_active_name
 ON character_profile_templates(world_id,name) WHERE archived_at IS NULL;
CREATE INDEX character_profile_templates_world
 ON character_profile_templates(world_id,archived_at,name);

DROP TRIGGER character_profile_schema_insert;
DROP TRIGGER character_profile_schema_update;

UPDATE game_entities
 SET data_json=json_set(data_json,'$.characterSchemaVersion',3)
 WHERE kind='character';
UPDATE character_profile_schema_versions SET schema_version=3;

CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,3,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,3,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
