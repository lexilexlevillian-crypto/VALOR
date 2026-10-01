DROP TRIGGER character_profile_schema_insert;
DROP TRIGGER character_profile_schema_update;

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.characterSchemaVersion',5,
  '$.registryStatus',COALESCE(json_extract(data_json,'$.registryStatus'),'active'),
  '$.profileVisibility',COALESCE(json_extract(data_json,'$.profileVisibility'),json_object(
   'description','campaign','legalName','campaign','aliases','campaign','ageYears','campaign',
   'sex','campaign','gender','campaign','pronouns','campaign','identity','campaign',
   'appearance','campaign','appearanceDescription','campaign','heightCm','campaign',
   'build','campaign','hair','campaign','eyes','campaign','complexion','campaign',
   'features','campaign','scars','campaign','tattoos','campaign','disabilities','campaign',
   'presentation','campaign','socialPresentation','campaign','attractivenessContext','campaign'
  ))
 )
 WHERE kind='character';
UPDATE character_profile_schema_versions SET schema_version=5;

CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,5,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,5,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;

CREATE TABLE npc_merge_records (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 source_npc_id TEXT NOT NULL,
 target_npc_id TEXT NOT NULL,
 merge_revision INTEGER NOT NULL,
 resolution_json TEXT NOT NULL CHECK(json_valid(resolution_json)),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_checksum TEXT NOT NULL,
 event_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 reversed_at TEXT,
 reversed_by TEXT REFERENCES users(id),
 UNIQUE(timeline_id,source_npc_id,target_npc_id,merge_revision)
) STRICT;
CREATE INDEX npc_merge_records_timeline ON npc_merge_records(timeline_id,created_at);
CREATE TRIGGER npc_merge_records_no_delete BEFORE DELETE ON npc_merge_records
 BEGIN SELECT RAISE(ABORT,'immutable npc merge record'); END;

CREATE TABLE npc_retirement_records (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 npc_id TEXT NOT NULL,
 strategy TEXT NOT NULL CHECK(strategy IN ('replacement','retirement')),
 replacement_id TEXT,
 narrative TEXT NOT NULL,
 event_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX npc_retirement_records_timeline ON npc_retirement_records(timeline_id,created_at);
CREATE TRIGGER npc_retirement_records_no_update BEFORE UPDATE ON npc_retirement_records
 BEGIN SELECT RAISE(ABORT,'immutable npc retirement record'); END;
CREATE TRIGGER npc_retirement_records_no_delete BEFORE DELETE ON npc_retirement_records
 BEGIN SELECT RAISE(ABORT,'immutable npc retirement record'); END;
