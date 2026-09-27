CREATE TABLE character_profile_schema_versions (
 timeline_id TEXT NOT NULL,
 character_id TEXT NOT NULL,
 schema_version INTEGER NOT NULL CHECK(schema_version>0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(timeline_id,character_id),
 FOREIGN KEY(timeline_id,character_id) REFERENCES game_entities(timeline_id,id)
) STRICT;
INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
 SELECT timeline_id,id,2,updated_at FROM game_entities WHERE kind='character';
CREATE INDEX character_profile_schema_versions_character ON character_profile_schema_versions(character_id);
CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,2,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,2,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;