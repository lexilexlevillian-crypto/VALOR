-- System 26: persistent accounts, ledger records, merchant stock, employment, housing, and explicit optional-needs policy.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.businessSchemaVersion',COALESCE(json_extract(data_json,'$.businessSchemaVersion'),2),
  '$.category',COALESCE(json_extract(data_json,'$.category'),'store'),
  '$.inventory',COALESCE(json_extract(data_json,'$.inventory'),json('[]')),
  '$.priceRule',COALESCE(json_extract(data_json,'$.priceRule'),json('{"mode":"item","neighborhoodMultiplier":1,"scarcityTarget":0,"scarcityMarkup":0,"buybackMultiplier":1,"minimumCents":0,"maximumCents":null}')),
  '$.sellerPolicy',COALESCE(json_extract(data_json,'$.sellerPolicy'),json('{"allowedCharacterIds":[],"requiredTags":[],"acceptsStolen":false}')),
  '$.sellerIds',COALESCE(json_extract(data_json,'$.sellerIds'),json('[]')),
  '$.requiredTrust',COALESCE(json_extract(data_json,'$.requiredTrust'),-100),
  '$.risk',COALESCE(json_extract(data_json,'$.risk'),0),
  '$.heatLimit',COALESCE(json_extract(data_json,'$.heatLimit'),100),
  '$.heatPerTransaction',COALESCE(json_extract(data_json,'$.heatPerTransaction'),0),
  '$.availableLocationIds',COALESCE(json_extract(data_json,'$.availableLocationIds'),json('[]')),
  '$.receiptPrefix',COALESCE(json_extract(data_json,'$.receiptPrefix'),'VALOR')
 ) WHERE kind='business';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.jobSchemaVersion',COALESCE(json_extract(data_json,'$.jobSchemaVersion'),2),
  '$.status',COALESCE(json_extract(data_json,'$.status'),'active'),
  '$.eligibility',COALESCE(json_extract(data_json,'$.eligibility'),json('{"allowedCharacterIds":[],"requiredTags":[],"requiredSkills":{}}')),
  '$.wagePayment',COALESCE(json_extract(data_json,'$.wagePayment'),'cash'),
  '$.tipRule',COALESCE(json_extract(data_json,'$.tipRule'),json('{"mode":"none","cents":0}')),
  '$.advancement',COALESCE(json_extract(data_json,'$.advancement'),json('{"shiftsRequired":0,"hourlyIncreaseCents":0,"maxHourlyCents":null}')),
  '$.absencePolicy',COALESCE(json_extract(data_json,'$.absencePolicy'),json('{"warningAfter":1,"terminateAfter":3,"description":""}')),
  '$.attendance',COALESCE(json_extract(data_json,'$.attendance'),json('[]')),
  '$.warnings',COALESCE(json_extract(data_json,'$.warnings'),0),
  '$.completedShifts',COALESCE(json_extract(data_json,'$.completedShifts'),0),
  '$.coworkerIds',COALESCE(json_extract(data_json,'$.coworkerIds'),json('[]'))
 ) WHERE kind='job';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.housingSchemaVersion',COALESCE(json_extract(data_json,'$.housingSchemaVersion'),2),
  '$.utilityBillIds',COALESCE(json_extract(data_json,'$.utilityBillIds'),json('[]')),
  '$.accessItemIds',COALESCE(json_extract(data_json,'$.accessItemIds'),json('[]')),
  '$.status',COALESCE(json_extract(data_json,'$.status'),'current'),
  '$.arrearsCents',COALESCE(json_extract(data_json,'$.arrearsCents'),0)
 ) WHERE kind='housing';

UPDATE timelines
 SET settings_json=json_set(settings_json,'$.campaign.needsPolicy',COALESCE(json_extract(settings_json,'$.campaign.needsPolicy'),json('{"ui":"hidden","costs":"none","penalties":"none"}')));

UPDATE campaign_configurations
 SET defaults_json=json_set(defaults_json,'$.needsPolicy',COALESCE(json_extract(defaults_json,'$.needsPolicy'),json('{"ui":"hidden","costs":"none","penalties":"none"}'))),
     overrides_json=json_set(overrides_json,'$.needsPolicy',COALESCE(json_extract(overrides_json,'$.needsPolicy'),json('{}')));

CREATE TRIGGER immutable_financial_records_update
 BEFORE UPDATE ON game_entities
 WHEN OLD.kind IN ('transaction','receipt')
 BEGIN SELECT RAISE(ABORT,'immutable financial record'); END;

CREATE TRIGGER immutable_financial_records_delete
 BEFORE DELETE ON game_entities
 WHEN OLD.kind IN ('transaction','receipt')
 BEGIN SELECT RAISE(ABORT,'immutable financial record'); END;
