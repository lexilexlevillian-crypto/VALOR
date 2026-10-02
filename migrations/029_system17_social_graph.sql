-- Upgrade legacy directional relationships without rewriting their authored history.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.relationshipSchemaVersion',2,
  '$.labelRecords',COALESCE(json_extract(data_json,'$.labelRecords'),json('[]')),
  '$.disclosure',COALESCE(json_extract(data_json,'$.disclosure'),CASE WHEN COALESCE(json_extract(data_json,'$.secret'),1)=1 THEN 'secret' ELSE 'private' END),
  '$.knownByIds',COALESCE(json_extract(data_json,'$.knownByIds'),json_array(json_extract(data_json,'$.fromId'),json_extract(data_json,'$.toId'))),
  '$.cooldownMinutes',COALESCE(json_extract(data_json,'$.cooldownMinutes'),60),
  '$.movementThreshold',COALESCE(json_extract(data_json,'$.movementThreshold'),1),
  '$.lastMeaningfulAt',json_extract(data_json,'$.lastMeaningfulAt')
 )
 WHERE kind='relationship';
