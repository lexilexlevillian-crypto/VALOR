DROP TRIGGER character_profile_schema_insert;
DROP TRIGGER character_profile_schema_update;

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.characterSchemaVersion',6,
  '$.simulationTier',COALESCE(json_extract(data_json,'$.simulationTier'),'distant'),
  '$.simulationTierReason',COALESCE(json_extract(data_json,'$.simulationTierReason'),'not currently material'),
  '$.activityTimeline',COALESCE(json_extract(data_json,'$.activityTimeline'),json('[]'))
 )
 WHERE kind='character';
UPDATE character_profile_schema_versions SET schema_version=6;

UPDATE timelines
 SET settings_json=json_set(
  settings_json,
  '$.npcCatchupWorkBudget',COALESCE(json_extract(settings_json,'$.npcCatchupWorkBudget'),200000),
  '$.npcInitiativeBudget',COALESCE(json_extract(settings_json,'$.npcInitiativeBudget'),500),
  '$.npcTimelineLimit',COALESCE(json_extract(settings_json,'$.npcTimelineLimit'),500)
 );

CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,6,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,6,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
