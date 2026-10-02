-- System 28: evidence lifecycle, case hypotheses, informants, and directional heat.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.evidenceSchemaVersion',2,
  '$.medium',COALESCE(json_extract(data_json,'$.medium'),'other'),
  '$.evidenceType',COALESCE(json_extract(data_json,'$.evidenceType'),'other'),
  '$.sourceLocationId',COALESCE(json_extract(data_json,'$.sourceLocationId'),json_extract(data_json,'$.locationId')),
  '$.sourceAt',json_extract(data_json,'$.sourceAt'),
  '$.objectIds',COALESCE(json_extract(data_json,'$.objectIds'),json('[]')),
  '$.personIds',COALESCE(json_extract(data_json,'$.personIds'),json('[]')),
  '$.caseIds',COALESCE(json_extract(data_json,'$.caseIds'),json('[]')),
  '$.collectorId',json_extract(data_json,'$.collectorId'),
  '$.collectedAt',json_extract(data_json,'$.collectedAt'),
  '$.knownByIds',COALESCE(json_extract(data_json,'$.knownByIds'),json_extract(data_json,'$.discoveredBy'),json('[]')),
  '$.condition',COALESCE(json_extract(data_json,'$.condition'),'intact'),
  '$.discoverability',COALESCE(json_extract(data_json,'$.discoverability'),json('{"concealed":false,"difficulty":0,"requiredTags":[]}')),
  '$.accessBasis',COALESCE(json_extract(data_json,'$.accessBasis'),'none'),
  '$.investigationOptions',COALESCE(json_extract(data_json,'$.investigationOptions'),json('[]')),
  '$.analyses',COALESCE(json_extract(data_json,'$.analyses'),json('[]')),
  '$.history',COALESCE(json_extract(data_json,'$.history'),json('[]'))
 ) WHERE kind='evidence';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.leadRecords',COALESCE(json_extract(data_json,'$.leadRecords'),json('[]')),
  '$.hypotheses',COALESCE(json_extract(data_json,'$.hypotheses'),json('[]')),
  '$.exclusions',COALESCE(json_extract(data_json,'$.exclusions'),json('[]')),
  '$.informantIds',COALESCE(json_extract(data_json,'$.informantIds'),json('[]'))
 ) WHERE kind='case';
