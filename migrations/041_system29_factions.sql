-- System 29: authored factions, membership privacy, orders, rumors, and living-city events.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.factionSchemaVersion',2,
  '$.publicIdentity',COALESCE(json_extract(data_json,'$.publicIdentity'),json('{"summary":"","values":[],"contact":""}')),
  '$.privateFacts',COALESCE(json_extract(data_json,'$.privateFacts'),json('[]')),
  '$.mood',COALESCE(json_extract(data_json,'$.mood'),'steady'),
  '$.pressure',COALESCE(json_extract(data_json,'$.pressure'),0),
  '$.hierarchy',COALESCE(json_extract(data_json,'$.hierarchy'),json('[]')),
  '$.memberships',COALESCE(json_extract(data_json,'$.memberships'),json('[]')),
  '$.territoryIds',COALESCE(json_extract(data_json,'$.territoryIds'),json_extract(data_json,'$.jurisdictionIds'),json('[]')),
  '$.resources',COALESCE(json_extract(data_json,'$.resources'),json('{}')),
  '$.practices',COALESCE(json_extract(data_json,'$.practices'),json('[]')),
  '$.rules',COALESCE(json_extract(data_json,'$.rules'),json('[]')),
  '$.enemyIds',COALESCE(json_extract(data_json,'$.enemyIds'),json('[]')),
  '$.allyIds',COALESCE(json_extract(data_json,'$.allyIds'),json('[]')),
  '$.relations',COALESCE(json_extract(data_json,'$.relations'),json('[]')),
  '$.goals',COALESCE(json_extract(data_json,'$.goals'),json('[]')),
  '$.knownIncidentIds',COALESCE(json_extract(data_json,'$.knownIncidentIds'),json('[]')),
  '$.reputationAudiences',COALESCE(json_extract(data_json,'$.reputationAudiences'),json('[]')),
  '$.eventHooks',COALESCE(json_extract(data_json,'$.eventHooks'),json('[]')),
  '$.simulationPolicy',json_extract(data_json,'$.simulationPolicy'),
  '$.lastFactionAt',json_extract(data_json,'$.lastFactionAt'),
  '$.history',COALESCE(json_extract(data_json,'$.history'),json('[]'))
 ) WHERE kind='faction';
