-- Durable 2012-era phone devices, contacts, communication records, and social identities.
UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.phoneSchemaVersion',2,
  '$.phoneNumber',COALESCE(json_extract(data_json,'$.phoneNumber'),''),
  '$.phoneType',COALESCE(json_extract(data_json,'$.phoneType'),'mobile'),
  '$.phoneState',COALESCE(json_extract(data_json,'$.phoneState'),'active'),
  '$.service',COALESCE(json_extract(data_json,'$.service'),'good'),
  '$.batteryRequired',COALESCE(json_extract(data_json,'$.batteryRequired'),json('true')),
  '$.authorizedUserIds',COALESCE(json_extract(data_json,'$.authorizedUserIds'),json('[]')),
  '$.phoneApps',COALESCE(json_extract(data_json,'$.phoneApps'),json_object('contacts',json('true'),'messages',json('true'),'calls',json('true'),'voicemail',json('true'),'camera',json('true'),'photos',json('true'),'email',json('true'),'gps',json('true'),'social',json('true'))),
  '$.contacts',COALESCE((SELECT json_group_array(json_set(value,'$.savedName',COALESCE(json_extract(value,'$.savedName'),json_extract(value,'$.label')),'$.number',COALESCE(json_extract(value,'$.number'),''),'$.alias',COALESCE(json_extract(value,'$.alias'),''),'$.source',COALESCE(json_extract(value,'$.source'),'creator'),'$.consentPrivacy',COALESCE(json_extract(value,'$.consentPrivacy'),'unknown'),'$.blocked',COALESCE(json_extract(value,'$.blocked'),json('false')),'$.favorite',COALESCE(json_extract(value,'$.favorite'),json('false')),'$.permissions',COALESCE(json_extract(value,'$.permissions'),json_object('calls',json('true'),'sms',json('true'),'mms',json('true'),'email',json('true'),'social',json('false'))))) FROM json_each(COALESCE(json_extract(data_json,'$.contacts'),json('[]')))),json('[]'))
 )
 WHERE kind='item' AND json_extract(data_json,'$.category')='phone';

UPDATE game_entities
 SET data_json=json_set(
  data_json,
  '$.messageSchemaVersion',2,
  '$.threadId',COALESCE(json_extract(data_json,'$.threadId'),''),
  '$.recipientPhoneId',json_extract(data_json,'$.recipientPhoneId'),
  '$.fromNumber',COALESCE(json_extract(data_json,'$.fromNumber'),''),
  '$.toNumber',COALESCE(json_extract(data_json,'$.toNumber'),''),
  '$.participants',COALESCE(json_extract(data_json,'$.participants'),json_array(json_extract(data_json,'$.fromId'),json_extract(data_json,'$.toId'))),
  '$.sentAt',COALESCE(json_extract(data_json,'$.sentAt'),json_extract(data_json,'$.at')),
  '$.availableAt',json_extract(data_json,'$.availableAt'),
  '$.deliveredAt',json_extract(data_json,'$.deliveredAt'),
  '$.receivedAt',json_extract(data_json,'$.receivedAt'),
  '$.readAt',json_extract(data_json,'$.readAt'),
  '$.attachments',COALESCE(json_extract(data_json,'$.attachments'),json('[]')),
  '$.deletedByIds',COALESCE(json_extract(data_json,'$.deletedByIds'),json('[]')),
  '$.hiddenFromIds',COALESCE(json_extract(data_json,'$.hiddenFromIds'),json('[]')),
  '$.failureReason',COALESCE(json_extract(data_json,'$.failureReason'),'')
 )
 WHERE kind='message';

DROP TRIGGER character_profile_schema_insert;
DROP TRIGGER character_profile_schema_update;
UPDATE game_entities
 SET data_json=json_set(data_json,'$.characterSchemaVersion',8,'$.socialConnections',COALESCE(json_extract(data_json,'$.socialConnections'),json_object('friendIds',json('[]'),'followingIds',json('[]'),'followerIds',json('[]'))))
 WHERE kind='character';
UPDATE character_profile_schema_versions SET schema_version=8;
CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,8,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities
 WHEN NEW.kind='character'
 BEGIN
  INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at)
  VALUES(NEW.timeline_id,NEW.id,8,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
 END;
