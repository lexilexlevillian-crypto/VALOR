-- Persistent condition detail, authored substance effects, and protected death aftermath.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.characterSchemaVersion',9,
  '$.pain',COALESCE(json_extract(data_json,'$.pain'),0),
  '$.restUntil',json_extract(data_json,'$.restUntil'),
  '$.activeSubstances',COALESCE(json_extract(data_json,'$.activeSubstances'),json('[]')),
  '$.withdrawalEnabled',COALESCE(json_extract(data_json,'$.withdrawalEnabled'),json('false')),
  '$.healthSummary',json_extract(data_json,'$.healthSummary'),
  '$.deathRecordId',json_extract(data_json,'$.deathRecordId')
 )
 WHERE kind='character';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.itemSchemaVersion',5,
  '$.substanceProfile',json_extract(data_json,'$.substanceProfile')
 )
 WHERE kind='item';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.healthSchemaVersion',2,
  '$.bodyRegion',COALESCE(json_extract(data_json,'$.bodyRegion'),CASE WHEN json_extract(data_json,'$.bodyPart')='systemic' THEN 'systemic' ELSE 'other' END),
  '$.side',COALESCE(json_extract(data_json,'$.side'),'none'),
  '$.stabilized',COALESCE(json_extract(data_json,'$.stabilized'),json('false')),
  '$.onsetAt',COALESCE(json_extract(data_json,'$.onsetAt'),json_extract(data_json,'$.startedAt')),
  '$.cause',COALESCE(json_extract(data_json,'$.cause'),json('{"kind":"unknown","sourceEntityId":null,"sourceEventId":null,"description":""}')),
  '$.symptoms',COALESCE(json_extract(data_json,'$.symptoms'),json('[]')),
  '$.mechanicalImpact',COALESCE(json_extract(data_json,'$.mechanicalImpact'),json('{"attributeModifiers":{},"fatiguePerDay":0,"movementPenalty":0,"perceptionPenalty":0,"incapacitateAtSeverity":null}')),
  '$.treatmentRequirements',COALESCE(json_extract(data_json,'$.treatmentRequirements'),json('{"requiredItemTags":[],"minimumQuality":0,"requiresClinical":false,"stabilizationMinutes":1}')),
  '$.course',COALESCE(json_extract(data_json,'$.course'),json_object('expectedDays',COALESCE(json_extract(data_json,'$.recoveryDays'),0),'recoveryPerDay',0,'deteriorationPerDay',0,'infectionRisk',0,'fatalAtSeverity',NULL,'leavesScar',json('false'),'status','acute','resolvedAt',NULL)),
  '$.healthVisibility',COALESCE(json_extract(data_json,'$.healthVisibility'),'symptoms'),
  '$.knownByIds',COALESCE(json_extract(data_json,'$.knownByIds'),json_array(json_extract(data_json,'$.characterId'))),
  '$.diagnosedByIds',COALESCE(json_extract(data_json,'$.diagnosedByIds'),json('[]')),
  '$.assessments',COALESCE(json_extract(data_json,'$.assessments'),json('[]')),
  '$.treatments',COALESCE(json_extract(data_json,'$.treatments'),json('[]')),
  '$.eventLinks',COALESCE(json_extract(data_json,'$.eventLinks'),json('[]'))
 )
 WHERE kind='injury';

UPDATE campaign_configurations
 SET defaults_json=json_set(defaults_json,'$.saveBehavior.postDeath',COALESCE(json_extract(defaults_json,'$.saveBehavior.postDeath'),'load-or-branch'));
