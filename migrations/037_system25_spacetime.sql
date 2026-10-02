-- System 25: richer authored place state and opt-in weather effects.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.access',COALESCE(json_extract(data_json,'$.access'),json('{"policy":"public","requiredItemIds":[],"requiredTags":[],"allowedCharacterIds":[],"description":""}')),
  '$.discoveredByIds',COALESCE(json_extract(data_json,'$.discoveredByIds'),json('[]')),
  '$.visitedByIds',COALESCE(json_extract(data_json,'$.visitedByIds'),json('[]')),
  '$.closedWeather',COALESCE(json_extract(data_json,'$.closedWeather'),json('[]')),
  '$.safety',COALESCE(json_extract(data_json,'$.safety'),json('{"level":"uncertain","notes":""}')),
  '$.heat',COALESCE(json_extract(data_json,'$.heat'),json('{}')),
  '$.mapPresentation',COALESCE(json_extract(data_json,'$.mapPresentation'),json('{"label":"","order":0,"x":null,"y":null,"icon":"","hidden":false}'))
 )
 WHERE kind='location';

UPDATE game_entities
 SET data_json=json_set(data_json,'$.closedWeather',COALESCE(json_extract(data_json,'$.closedWeather'),json('[]')))
 WHERE kind='business';

UPDATE timelines
 SET settings_json=json_set(
  settings_json,
  '$.weatherVisibilityPenalties',COALESCE(json_extract(settings_json,'$.weatherVisibilityPenalties'),json('{}')),
  '$.weatherMood',COALESCE(json_extract(settings_json,'$.weatherMood'),json('{}'))
 );
