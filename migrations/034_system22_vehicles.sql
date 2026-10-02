-- Persistent vehicle identity, access, custody, route, theft, damage, repair, and evidence state.
UPDATE game_entities AS vehicle
 SET data_json=json_set(
  data_json,
  '$.vehicleSchemaVersion',2,
  '$.registeredOwnerId',json_extract(data_json,'$.registeredOwnerId'),
  '$.keyIds',COALESCE(json_extract(data_json,'$.keyIds'),CASE WHEN json_extract(data_json,'$.keyId') IS NULL THEN json('[]') ELSE json_array(json_extract(data_json,'$.keyId')) END),
  '$.vin',COALESCE(json_extract(data_json,'$.vin'),''),
  '$.make',COALESCE(json_extract(data_json,'$.make'),''),
  '$.model',COALESCE(json_extract(data_json,'$.model'),''),
  '$.year',json_extract(data_json,'$.year'),
  '$.color',COALESCE(json_extract(data_json,'$.color'),''),
  '$.odometerKm',COALESCE(json_extract(data_json,'$.odometerKm'),0),
  '$.ignition',COALESCE(json_extract(data_json,'$.ignition'),'off'),
  '$.authorizedDriverIds',COALESCE(json_extract(data_json,'$.authorizedDriverIds'),json('[]')),
  '$.accessGrants',COALESCE(json_extract(data_json,'$.accessGrants'),json('[]')),
  '$.hotwiredByIds',COALESCE(json_extract(data_json,'$.hotwiredByIds'),json('[]')),
  '$.routeState',json_extract(data_json,'$.routeState'),
  '$.custodianId',json_extract(data_json,'$.custodianId'),
  '$.custodyRole',json_extract(data_json,'$.custodyRole'),
  '$.custodyHistory',COALESCE(json_extract(data_json,'$.custodyHistory'),json('[]')),
  '$.theftStatus',COALESCE(json_extract(data_json,'$.theftStatus'),CASE WHEN json_extract(data_json,'$.stolen')=1 THEN 'stolen' ELSE 'none' END),
  '$.theftReports',COALESCE(json_extract(data_json,'$.theftReports'),json('[]')),
  '$.discoveredByIds',COALESCE(json_extract(data_json,'$.discoveredByIds'),json('[]')),
  '$.damageRecords',COALESCE(json_extract(data_json,'$.damageRecords'),json('[]')),
  '$.repairRecords',COALESCE(json_extract(data_json,'$.repairRecords'),json('[]')),
  '$.witnessDescriptions',COALESCE(json_extract(data_json,'$.witnessDescriptions'),json('[]')),
  '$.evidenceHooks',COALESCE(json_extract(data_json,'$.evidenceHooks'),json('{"toll":false,"parking":false,"cctv":false}')),
  '$.roles',COALESCE(json_extract(data_json,'$.roles'),json('[]')),
  '$.roleLinks',COALESCE(json_extract(data_json,'$.roleLinks'),json('[]')),
  '$.history',COALESCE(json_extract(data_json,'$.history'),json('[]'))
 )
 WHERE kind='vehicle';
