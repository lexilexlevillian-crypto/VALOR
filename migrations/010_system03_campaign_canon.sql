-- System 03: campaign configuration and versioned, data-driven canon.
-- Configuration is separate from timeline simulation settings so a timeline
-- cannot silently become the owner of campaign policy.
CREATE TABLE campaign_configurations (
 campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
 defaults_json TEXT NOT NULL CHECK(json_valid(defaults_json)),
 overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES users(id)
) STRICT;

INSERT INTO campaign_configurations
 (campaign_id,schema_version,defaults_json,overrides_json,revision,created_at,updated_at,updated_by)
SELECT id,1,
 json_object(
  'startAt',starting_at,
  'timezone',timezone,
  'calendar',json_object('id','gregorian','daysPerWeek',7,'firstDayOfWeek',0,'months',json_array()),
  'enabledSystems',json_object(),
  'difficulty','grounded',
  'contentRating','mature',
  'matureContent','fade-to-black',
  'needsIntensity','off',
  'injuryIntensity','grounded',
  'lawEnforcement',json_object('profileId',NULL,'posture','authored','variance',json_object()),
  'technology',json_object('era','authored','features',json_object(),'serviceVariability','authored'),
  'travelAbstraction','route',
  'saveBehavior',json_object('autosave','safe-commit','branchOnDeath',1,'maxManualSaves',100),
  'uiDefaults',json_object('density','compact','startView','chronicle','mapMode','list')
 ),'{}',1,created_at,updated_at,owner_id
FROM campaigns;

CREATE TABLE canon_records (
 record_id TEXT PRIMARY KEY REFERENCES records(id),
 world_id TEXT NOT NULL REFERENCES worlds(id),
 slug TEXT NOT NULL,
 aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)),
 source_status TEXT NOT NULL CHECK(source_status IN ('draft','published','archived')),
 valid_from TEXT, valid_until TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
 archived_at TEXT,
 UNIQUE(world_id,slug)
) STRICT;

CREATE TABLE canon_record_links (
 source_record_id TEXT NOT NULL REFERENCES records(id),
 target_record_id TEXT NOT NULL REFERENCES records(id),
 relation TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(source_record_id,target_record_id,relation),
 CHECK(source_record_id<>target_record_id)
) STRICT;

CREATE TABLE canon_revisions (
 id TEXT PRIMARY KEY,
 world_id TEXT NOT NULL REFERENCES worlds(id),
 revision INTEGER NOT NULL CHECK(revision > 0),
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 note TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, published_at TEXT, archived_at TEXT,
 UNIQUE(world_id,revision)
) STRICT;

-- Snapshot rows are immutable. Later edits to reusable records cannot rewrite
-- a published canon revision or a timeline that was bound to it.
CREATE TABLE canon_revision_records (
 revision_id TEXT NOT NULL REFERENCES canon_revisions(id),
 record_id TEXT NOT NULL REFERENCES records(id),
 record_revision INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(revision_id,record_id)
) STRICT;

CREATE TABLE campaign_canon_bindings (
 campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
 canon_revision_id TEXT REFERENCES canon_revisions(id),
 bound_at TEXT NOT NULL, bound_by TEXT NOT NULL REFERENCES users(id)
) STRICT;

CREATE TABLE timeline_canon_bindings (
 timeline_id TEXT PRIMARY KEY REFERENCES timelines(id),
 canon_revision_id TEXT REFERENCES canon_revisions(id),
 bound_at TEXT NOT NULL
) STRICT;

CREATE TABLE event_canon_bindings (
 event_id TEXT PRIMARY KEY REFERENCES game_events(id),
 canon_revision_id TEXT NOT NULL REFERENCES canon_revisions(id),
 bound_at TEXT NOT NULL
) STRICT;

CREATE INDEX canon_records_world ON canon_records(world_id,source_status,slug);
CREATE INDEX canon_links_target ON canon_record_links(target_record_id);
CREATE INDEX canon_revisions_world ON canon_revisions(world_id,status,revision);
CREATE INDEX canon_revision_records_record ON canon_revision_records(record_id,revision_id);

CREATE TRIGGER canon_revision_records_immutable_update BEFORE UPDATE ON canon_revision_records BEGIN SELECT RAISE(ABORT,'immutable canon revision snapshot'); END;
CREATE TRIGGER canon_revision_records_immutable_delete BEFORE DELETE ON canon_revision_records BEGIN SELECT RAISE(ABORT,'immutable canon revision snapshot'); END;


-- Register System 03 artifacts in the System 01 schema registry.
INSERT OR IGNORE INTO artifact_schema_versions
 (artifact_type,artifact_id,scope_type,scope_id,schema_version,created_at)
SELECT 'campaign_configuration',campaign_id,'campaign',campaign_id,schema_version,created_at FROM campaign_configurations
UNION ALL SELECT 'canon_record',record_id,'world',world_id,1,created_at FROM canon_records
UNION ALL SELECT 'canon_revision',id,'world',world_id,1,created_at FROM canon_revisions
UNION ALL SELECT 'canon_revision_record',revision_id||':'||record_id,'world',r.world_id,1,revision.created_at FROM canon_revision_records rr JOIN canon_revisions revision ON revision.id=rr.revision_id JOIN records r ON r.id=rr.record_id
UNION ALL SELECT 'campaign_canon_binding',campaign_id,'campaign',campaign_id,1,bound_at FROM campaign_canon_bindings
UNION ALL SELECT 'timeline_canon_binding',timeline_id,'campaign',t.campaign_id,1,bound_at FROM timeline_canon_bindings b JOIN timelines t ON t.id=b.timeline_id
UNION ALL SELECT 'event_canon_binding',event_id,'campaign',t.campaign_id,1,b.bound_at FROM event_canon_bindings b JOIN game_events e ON e.id=b.event_id JOIN timelines t ON t.id=e.timeline_id;
CREATE TRIGGER artifact_schema_campaign_config_insert AFTER INSERT ON campaign_configurations BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('campaign_configuration',NEW.campaign_id,'campaign',NEW.campaign_id,NEW.schema_version,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_canon_record_insert AFTER INSERT ON canon_records BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('canon_record',NEW.record_id,'world',NEW.world_id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_canon_revision_insert AFTER INSERT ON canon_revisions BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('canon_revision',NEW.id,'world',NEW.world_id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_canon_revision_record_insert AFTER INSERT ON canon_revision_records BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'canon_revision_record',NEW.revision_id||':'||NEW.record_id,'world',r.world_id,1,cr.created_at FROM canon_revisions cr JOIN records r ON r.id=NEW.record_id WHERE cr.id=NEW.revision_id;
END;
CREATE TRIGGER artifact_schema_campaign_canon_binding_insert AFTER INSERT ON campaign_canon_bindings BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('campaign_canon_binding',NEW.campaign_id,'campaign',NEW.campaign_id,1,NEW.bound_at);
END;
CREATE TRIGGER artifact_schema_timeline_canon_binding_insert AFTER INSERT ON timeline_canon_bindings BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'timeline_canon_binding',NEW.timeline_id,'campaign',t.campaign_id,1,NEW.bound_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_event_canon_binding_insert AFTER INSERT ON event_canon_bindings BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'event_canon_binding',NEW.event_id,'campaign',t.campaign_id,1,NEW.bound_at FROM game_events e JOIN timelines t ON t.id=e.timeline_id WHERE e.id=NEW.event_id;
END;
