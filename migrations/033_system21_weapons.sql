-- Persistent firearm, magazine, ammunition, carry, maintenance, and armor state.
UPDATE game_entities AS item
 SET data_json=json_set(
  data_json,
  '$.itemSchemaVersion',4,
  '$.weaponSchemaVersion',COALESCE(json_extract(data_json,'$.weaponSchemaVersion'),1),
  '$.weaponFamily',COALESCE(json_extract(data_json,'$.weaponFamily'),json_extract(data_json,'$.proficiency'),''),
  '$.ammoType',COALESCE(json_extract(data_json,'$.ammoType'),''),
  '$.compatibleAmmoTypes',COALESCE(json_extract(data_json,'$.compatibleAmmoTypes'),json('[]')),
  '$.magazineFamily',COALESCE(json_extract(data_json,'$.magazineFamily'),''),
  '$.compatibleMagazineFamilies',COALESCE(json_extract(data_json,'$.compatibleMagazineFamilies'),json('[]')),
  '$.installedMagazineId',json_extract(data_json,'$.installedMagazineId'),
  '$.chamberState',COALESCE(json_extract(data_json,'$.chamberState'),'not-modeled'),
  '$.chamberAmmoType',COALESCE(json_extract(data_json,'$.chamberAmmoType'),''),
  '$.malfunction',COALESCE(json_extract(data_json,'$.malfunction'),'none'),
  '$.lastMaintainedAt',json_extract(data_json,'$.lastMaintainedAt'),
  '$.shotsSinceMaintenance',COALESCE(json_extract(data_json,'$.shotsSinceMaintenance'),0),
  '$.attachmentIds',COALESCE(json_extract(data_json,'$.attachmentIds'),json('[]')),
  '$.carryState',COALESCE(json_extract(data_json,'$.carryState'),CASE WHEN json_extract(data_json,'$.equipped')=1 THEN 'held' ELSE 'stored' END),
  '$.concealmentContextId',COALESCE(json_extract(data_json,'$.concealmentContextId'),CASE WHEN json_extract(data_json,'$.concealed')=1 THEN json_extract(data_json,'$.possessorId') ELSE NULL END),
  '$.protectionClass',COALESCE(json_extract(data_json,'$.protectionClass'),'')
 )
 WHERE kind='item';
