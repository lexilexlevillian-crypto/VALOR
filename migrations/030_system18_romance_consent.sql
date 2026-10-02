-- Legacy pending labels were invitations, not proof of current contextual consent.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.consentRequests',COALESCE(json_extract(data_json,'$.consentRequests'),json('[]')),
  '$.pending','',
  '$.relationshipStyle',COALESCE(json_extract(data_json,'$.relationshipStyle'),'unspecified'),
  '$.exclusivityStatus',COALESCE(json_extract(data_json,'$.exclusivityStatus'),'none')
 )
 WHERE kind='relationship';

DROP TRIGGER character_profile_schema_insert;
DROP TRIGGER character_profile_schema_update;

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.characterSchemaVersion',7,
  '$.contentFilters',COALESCE(json_extract(data_json,'$.contentFilters'),json_object('romance','enabled','matureContent','campaign','blockedIntents',json('[]'),'allowNpcInitiative',json('true')))
 )
 WHERE kind='character';
UPDATE character_profile_schema_versions SET schema_version=7;

UPDATE campaign_configurations
 SET defaults_json=json_set(
  defaults_json,
  '$.relationshipSafety',COALESCE(json_extract(defaults_json,'$.relationshipSafety'),json_object('minimumRomanceAge',18,'minimumIntimacyAge',18,'consentWindowMinutes',30,'intoxicationBlocksConsentAt',50,'allowNpcInitiative',json('true')))
 );

CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,7,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,7,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
