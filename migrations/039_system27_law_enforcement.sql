-- System 27: crimes, witness reports, enforcement posture, legal authority, and timed process state.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.strength',COALESCE(json_extract(data_json,'$.strength'),25),
  '$.reliability',COALESCE(json_extract(data_json,'$.reliability'),75),
  '$.crimeId',json_extract(data_json,'$.crimeId')
 ) WHERE kind='evidence';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.caseSchemaVersion',COALESCE(json_extract(data_json,'$.caseSchemaVersion'),2),
  '$.suspectStatus',COALESCE(json_extract(data_json,'$.suspectStatus'),json('{}')),
  '$.crimeIds',COALESCE(json_extract(data_json,'$.crimeIds'),json('[]')),
  '$.reportIds',COALESCE(json_extract(data_json,'$.reportIds'),json('[]')),
  '$.factIds',COALESCE(json_extract(data_json,'$.factIds'),json('[]')),
  '$.priority',COALESCE(json_extract(data_json,'$.priority'),0),
  '$.evidenceScore',COALESCE(json_extract(data_json,'$.evidenceScore'),0),
  '$.reportedAt',json_extract(data_json,'$.reportedAt'),
  '$.bookedAt',json_extract(data_json,'$.bookedAt'),
  '$.bookingCompletesAt',json_extract(data_json,'$.bookingCompletesAt'),
  '$.holdingUntil',json_extract(data_json,'$.holdingUntil'),
  '$.courtAt',json_extract(data_json,'$.courtAt'),
  '$.releasedAt',json_extract(data_json,'$.releasedAt'),
  '$.releaseEligible',COALESCE(json_extract(data_json,'$.releaseEligible'),json('false')),
  '$.postureSourceIds',COALESCE(json_extract(data_json,'$.postureSourceIds'),json('[]')),
  '$.history',COALESCE(json_extract(data_json,'$.history'),json('[]'))
 ) WHERE kind='case';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.stopEvidence',COALESCE(json_extract(data_json,'$.stopEvidence'),0),
  '$.searchEvidence',COALESCE(json_extract(data_json,'$.searchEvidence'),0),
  '$.arrestEvidence',COALESCE(json_extract(data_json,'$.arrestEvidence'),0),
  '$.chargeEvidence',COALESCE(json_extract(data_json,'$.chargeEvidence'),1)
 ) WHERE kind='law';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.crimeId',json_extract(data_json,'$.crimeId'),
  '$.caseId',json_extract(data_json,'$.caseId'),
  '$.reportId',json_extract(data_json,'$.reportId'),
  '$.priority',COALESCE(json_extract(data_json,'$.priority'),0),
  '$.postureSourceIds',COALESCE(json_extract(data_json,'$.postureSourceIds'),json('[]'))
 ) WHERE kind='dispatch';
