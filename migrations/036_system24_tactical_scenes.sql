-- Versioned tactical locations and combat state. Chase records are created as first-class entities.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.tacticalZones',COALESCE(json_extract(data_json,'$.tacticalZones'),json('[]')),
  '$.tacticalFeatures',COALESCE(json_extract(data_json,'$.tacticalFeatures'),json('[]'))
 )
 WHERE kind='location';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.combatSchemaVersion',2,
  '$.locationId',json_extract(data_json,'$.locationId'),
  '$.sides',COALESCE(json_extract(data_json,'$.sides'),json('{}')),
  '$.turnOrder',COALESCE(json_extract(data_json,'$.turnOrder'),json_extract(data_json,'$.participants')),
  '$.phase',COALESCE(json_extract(data_json,'$.phase'),'engaged'),
  '$.endedReason',json_extract(data_json,'$.endedReason'),
  '$.exitConditions',COALESCE(json_extract(data_json,'$.exitConditions'),json('[\"opposition-incapacitated\",\"side-surrenders\",\"participant-flees\",\"death\",\"manual-disengage\"]')),
  '$.actorStates',COALESCE(json_extract(data_json,'$.actorStates'),json('{}')),
  '$.zoneIds',COALESCE(json_extract(data_json,'$.zoneIds'),json('[]')),
  '$.usedFeatureIds',COALESCE(json_extract(data_json,'$.usedFeatureIds'),json('[]'))
 )
 WHERE kind='combat';
