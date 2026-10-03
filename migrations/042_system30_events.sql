-- System 30: authored dynamic events, bounded watchers, learned journal entries, and traceability.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.eventSchemaVersion',2,
  '$.premise',COALESCE(json_extract(data_json,'$.premise'),json_extract(data_json,'$.description'),''),
  '$.ownerId',json_extract(data_json,'$.ownerId'),
  '$.sourceId',json_extract(data_json,'$.sourceId'),
  '$.state',COALESCE(json_extract(data_json,'$.state'),json_extract(data_json,'$.status'),'dormant'),
  '$.triggerConditions',COALESCE(json_extract(data_json,'$.triggerConditions'),json('[]')),
  '$.stateMachine',COALESCE(json_extract(data_json,'$.stateMachine'),json('[]')),
  '$.participants',COALESCE(json_extract(data_json,'$.participants'),json('[]')),
  '$.locationIds',COALESCE(json_extract(data_json,'$.locationIds'),json('[]')),
  '$.stakes',COALESCE(json_extract(data_json,'$.stakes'),''),
  '$.objectiveRecords',COALESCE(json_extract(data_json,'$.objectiveRecords'),json('[]')),
  '$.activeBranchId',COALESCE(json_extract(data_json,'$.activeBranchId'),''),
  '$.possibleOutcomes',COALESCE(json_extract(data_json,'$.possibleOutcomes'),json('[]')),
  '$.followUpTriggers',COALESCE(json_extract(data_json,'$.followUpTriggers'),json('[]')),
  '$.timelineScope',COALESCE(json_extract(data_json,'$.timelineScope'),'timeline'),
  '$.allowOffscreenResolution',COALESCE(json_extract(data_json,'$.allowOffscreenResolution'),json('true')),
  '$.knownByIds',COALESCE(json_extract(data_json,'$.knownByIds'),json('[]')),
  '$.journal',COALESCE(json_extract(data_json,'$.journal'),json('[]')),
  '$.trace',COALESCE(json_extract(data_json,'$.trace'),json('[]'))
 ) WHERE kind='quest';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.watcherSchemaVersion',2,
  '$.eventId',json_extract(data_json,'$.eventId'),
  '$.sourceEntityId',json_extract(data_json,'$.sourceEntityId'),
  '$.toState',COALESCE(json_extract(data_json,'$.toState'),''),
  '$.outcomeId',json_extract(data_json,'$.outcomeId'),
  '$.branchId',COALESCE(json_extract(data_json,'$.branchId'),''),
  '$.lastEvaluationAt',json_extract(data_json,'$.lastEvaluationAt'),
  '$.evaluationCount',COALESCE(json_extract(data_json,'$.evaluationCount'),0),
  '$.idempotencyKey',COALESCE(json_extract(data_json,'$.idempotencyKey'),''),
  '$.changeKinds',COALESCE(json_extract(data_json,'$.changeKinds'),json('[]')),
  '$.notifyCharacterIds',COALESCE(json_extract(data_json,'$.notifyCharacterIds'),json('[]')),
  '$.journalText',COALESCE(json_extract(data_json,'$.journalText'),''),
  '$.suppressed',COALESCE(json_extract(data_json,'$.suppressed'),json('false')),
  '$.trace',COALESCE(json_extract(data_json,'$.trace'),json('[]'))
 ) WHERE kind='watcher';
