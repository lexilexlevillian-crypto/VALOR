-- System 01 completion: canonical command/event envelopes, compatibility policy,
-- and complete artifact schema registration for campaign-owned state.
CREATE TABLE foundation_commands (
 id TEXT PRIMARY KEY,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
 type TEXT NOT NULL CHECK(type IN (
  'CreateCharacter','EditCharacter','StartCampaign','AdvanceWorldTime','MoveActor',
  'TransferItem','AddContact','SendText','StartConversation','ResolveCheck',
  'StartCombat','CreateEvidence','TriggerWatcher','CreateSave','BranchTimeline'
 )),
 actor_id TEXT NOT NULL REFERENCES users(id),
 scope_type TEXT NOT NULL CHECK(scope_type IN ('world','campaign')),
 scope_id TEXT NOT NULL,
 timeline_id TEXT REFERENCES timelines(id),
 aggregate_id TEXT,
 expected_revision INTEGER CHECK(expected_revision IS NULL OR expected_revision > 0),
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 created_at TEXT NOT NULL,
 UNIQUE(scope_type,scope_id,actor_id,idempotency_key)
) STRICT;
CREATE TABLE foundation_events (
 id TEXT PRIMARY KEY,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
 command_id TEXT NOT NULL UNIQUE REFERENCES foundation_commands(id),
 type TEXT NOT NULL CHECK(type IN (
  'CharacterCreated','CharacterEdited','CampaignStarted','WorldTimeAdvanced','ActorMoved',
  'ItemTransferred','ContactAdded','TextSent','ConversationStarted','CheckResolved',
  'CombatStarted','EvidenceCreated','WatcherTriggered','SaveCreated','TimelineBranched'
 )),
 actor_id TEXT NOT NULL REFERENCES users(id),
 scope_type TEXT NOT NULL CHECK(scope_type IN ('world','campaign')),
 scope_id TEXT NOT NULL,
 timeline_id TEXT REFERENCES timelines(id),
 aggregate_id TEXT NOT NULL,
 aggregate_revision INTEGER NOT NULL CHECK(aggregate_revision > 0),
 source_event_id TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 seed TEXT NOT NULL CHECK(length(seed)=64),
 rng_version TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE foundation_command_receipts (
 command_id TEXT PRIMARY KEY REFERENCES foundation_commands(id),
 event_id TEXT NOT NULL UNIQUE REFERENCES foundation_events(id),
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE schema_compatibility (
 component TEXT PRIMARY KEY,
 current_version INTEGER NOT NULL CHECK(current_version > 0),
 minimum_reader_version INTEGER NOT NULL CHECK(minimum_reader_version > 0),
 minimum_writer_version INTEGER NOT NULL CHECK(minimum_writer_version > 0),
 recovery_policy TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(minimum_reader_version <= current_version),
 CHECK(minimum_writer_version <= current_version)
) STRICT;
INSERT INTO schema_compatibility VALUES
 ('foundation-command',1,1,1,'forward-only; restore verified pre-migration backup for rollback',CURRENT_TIMESTAMP),
 ('foundation-event',1,1,1,'events are immutable; transform by appending a newer-version event',CURRENT_TIMESTAMP),
 ('campaign-artifact',1,1,1,'additive columns/tables; transform in a new transaction; restore verified backup on failure',CURRENT_TIMESTAMP),
 ('server-projection',1,1,1,'rebuild from canonical tables and immutable history; projections are never authoritative',CURRENT_TIMESTAMP);
CREATE INDEX foundation_commands_scope ON foundation_commands(scope_type,scope_id,created_at,id);
CREATE INDEX foundation_events_scope ON foundation_events(scope_type,scope_id,created_at,id);
CREATE INDEX foundation_events_timeline ON foundation_events(timeline_id,created_at,id);
CREATE TRIGGER foundation_commands_no_update BEFORE UPDATE ON foundation_commands BEGIN SELECT RAISE(ABORT,'immutable foundation command'); END;
CREATE TRIGGER foundation_commands_no_delete BEFORE DELETE ON foundation_commands BEGIN SELECT RAISE(ABORT,'immutable foundation command'); END;
CREATE TRIGGER foundation_events_no_update BEFORE UPDATE ON foundation_events BEGIN SELECT RAISE(ABORT,'immutable foundation event'); END;
CREATE TRIGGER foundation_events_no_delete BEFORE DELETE ON foundation_events BEGIN SELECT RAISE(ABORT,'immutable foundation event'); END;
CREATE TRIGGER foundation_receipts_no_update BEFORE UPDATE ON foundation_command_receipts BEGIN SELECT RAISE(ABORT,'immutable foundation receipt'); END;
CREATE TRIGGER foundation_receipts_no_delete BEFORE DELETE ON foundation_command_receipts BEGIN SELECT RAISE(ABORT,'immutable foundation receipt'); END;

-- Close schema registry gaps left by artifacts introduced after migration 008.
INSERT OR IGNORE INTO artifact_schema_versions
 (artifact_type,artifact_id,scope_type,scope_id,schema_version,created_at)
SELECT 'world',id,'world',id,1,created_at FROM worlds
UNION ALL SELECT 'campaign',id,'campaign',id,1,created_at FROM campaigns
UNION ALL SELECT 'membership',campaign_id||':'||user_id,'campaign',campaign_id,1,created_at FROM memberships
UNION ALL SELECT 'campaign_start_package',id,'campaign',campaign_id,schema_version,created_at FROM campaign_start_packages
UNION ALL SELECT 'character_profile_schema',p.timeline_id||':'||p.character_id,'campaign',t.campaign_id,p.schema_version,p.updated_at FROM character_profile_schema_versions p JOIN timelines t ON t.id=p.timeline_id
UNION ALL SELECT 'check_record',c.id,'campaign',t.campaign_id,1,c.created_at FROM check_records c JOIN timelines t ON t.id=c.timeline_id
UNION ALL SELECT 'game_receipt',r.timeline_id||':'||r.actor_id||':'||r.key,'campaign',t.campaign_id,1,e.created_at FROM game_receipts r JOIN timelines t ON t.id=r.timeline_id JOIN game_events e ON e.timeline_id=r.timeline_id AND e.revision=json_extract(r.result_json,'$.revision')
UNION ALL SELECT 'game_outbox',o.event_id,'campaign',t.campaign_id,1,o.created_at FROM game_outbox o JOIN game_events e ON e.id=o.event_id JOIN timelines t ON t.id=e.timeline_id;

CREATE TRIGGER artifact_schema_world_insert AFTER INSERT ON worlds BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('world',NEW.id,'world',NEW.id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_campaign_insert AFTER INSERT ON campaigns BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('campaign',NEW.id,'campaign',NEW.id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_membership_insert AFTER INSERT ON memberships BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('membership',NEW.campaign_id||':'||NEW.user_id,'campaign',NEW.campaign_id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_start_package_insert AFTER INSERT ON campaign_start_packages BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('campaign_start_package',NEW.id,'campaign',NEW.campaign_id,NEW.schema_version,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_character_profile_insert AFTER INSERT ON character_profile_schema_versions BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'character_profile_schema',NEW.timeline_id||':'||NEW.character_id,'campaign',t.campaign_id,NEW.schema_version,NEW.updated_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_check_record_insert AFTER INSERT ON check_records BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'check_record',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_game_receipt_insert AFTER INSERT ON game_receipts BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'game_receipt',NEW.timeline_id||':'||NEW.actor_id||':'||NEW.key,'campaign',t.campaign_id,1,CURRENT_TIMESTAMP FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_game_outbox_insert AFTER INSERT ON game_outbox BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'game_outbox',NEW.event_id,'campaign',t.campaign_id,1,NEW.created_at FROM game_events e JOIN timelines t ON t.id=e.timeline_id WHERE e.id=NEW.event_id;
END;
CREATE TRIGGER artifact_schema_foundation_command_insert AFTER INSERT ON foundation_commands BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('foundation_command',NEW.id,NEW.scope_type,NEW.scope_id,NEW.schema_version,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_foundation_event_insert AFTER INSERT ON foundation_events BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('foundation_event',NEW.id,NEW.scope_type,NEW.scope_id,NEW.schema_version,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_foundation_receipt_insert AFTER INSERT ON foundation_command_receipts BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions
 SELECT 'foundation_command_receipt',NEW.command_id,c.scope_type,c.scope_id,1,NEW.created_at FROM foundation_commands c WHERE c.id=NEW.command_id;
END;
