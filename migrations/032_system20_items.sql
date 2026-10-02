-- Persistent object instances: legal ownership is distinct from physical possession.
UPDATE game_entities AS item
 SET data_json=json_set(
  data_json,
  '$.itemSchemaVersion',3,
  '$.typeId',json_extract(data_json,'$.typeId'),
  '$.possessorId',COALESCE(
   json_extract(data_json,'$.possessorId'),
   CASE WHEN EXISTS(
    SELECT 1 FROM game_entities AS owner
     WHERE owner.timeline_id=item.timeline_id
      AND owner.id=json_extract(item.data_json,'$.ownerId')
      AND owner.kind='character'
      AND owner.archived_at IS NULL
   ) THEN json_extract(data_json,'$.ownerId') ELSE NULL END
  ),
  '$.concealment',COALESCE(json_extract(data_json,'$.concealment'),CASE WHEN json_extract(data_json,'$.concealed')=1 THEN 50 ELSE 0 END),
  '$.discoveredByIds',COALESCE(json_extract(data_json,'$.discoveredByIds'),json('[]')),
  '$.wearState',COALESCE(json_extract(data_json,'$.wearState'),CASE WHEN json_extract(data_json,'$.equipped')=1 THEN 'equipped' ELSE 'stowed' END),
  '$.provenanceRecords',COALESCE(json_extract(data_json,'$.provenanceRecords'),json('[]')),
  '$.markings',COALESCE(json_extract(data_json,'$.markings'),json('[]')),
  '$.modifications',COALESCE(json_extract(data_json,'$.modifications'),json('[]')),
  '$.secretContents',COALESCE(json_extract(data_json,'$.secretContents'),''),
  '$.instanceData',COALESCE(json_extract(data_json,'$.instanceData'),json('{}')),
  '$.eventHistory',COALESCE(json_extract(data_json,'$.eventHistory'),json('[]'))
 )
 WHERE kind='item';
