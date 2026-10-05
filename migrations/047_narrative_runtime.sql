-- Presentation preferences and immutable narration audit; never a second world store.
CREATE TABLE narrative_preferences (scope TEXT NOT NULL CHECK(scope IN ('user','campaign','character','scene')),scope_id TEXT NOT NULL,user_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('GAME','STORY')),revision INTEGER NOT NULL,patch_json TEXT NOT NULL,PRIMARY KEY(scope,scope_id,user_id,mode));
CREATE TABLE narrative_preference_history (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,scope_id TEXT NOT NULL,mode TEXT NOT NULL,revision INTEGER NOT NULL,patch_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE narrative_presets (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,revision INTEGER NOT NULL,profile_json TEXT NOT NULL);
CREATE TABLE narrative_render_records (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES game_events(id),timeline_id TEXT NOT NULL REFERENCES timelines(id),user_id TEXT NOT NULL REFERENCES users(id),version_id TEXT REFERENCES narration_versions(id),record_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX narrative_render_event ON narrative_render_records(event_id,created_at);
CREATE TRIGGER narrative_render_immutable_update BEFORE UPDATE ON narrative_render_records BEGIN SELECT RAISE(ABORT,'immutable_narrative_render'); END;
CREATE TRIGGER narrative_render_immutable_delete BEFORE DELETE ON narrative_render_records BEGIN SELECT RAISE(ABORT,'immutable_narrative_render'); END;
CREATE TRIGGER narrative_preferences_history_immutable_update BEFORE UPDATE ON narrative_preference_history BEGIN SELECT RAISE(ABORT,'immutable_narrative_preferences'); END;
CREATE TRIGGER narrative_preferences_history_immutable_delete BEFORE DELETE ON narrative_preference_history BEGIN SELECT RAISE(ABORT,'immutable_narrative_preferences'); END;

-- Voice and language fields are additive to existing characters.
UPDATE game_entities SET data_json=json_set(data_json,'$.characterSchemaVersion',10,'$.voiceProfile',json_extract(data_json,'$.voiceProfile'),'$.communication',json_extract(data_json,'$.communication')) WHERE kind='character';
DROP TRIGGER IF EXISTS character_profile_schema_insert;
DROP TRIGGER IF EXISTS character_profile_schema_update;
UPDATE character_profile_schema_versions SET schema_version=10;
CREATE TRIGGER character_profile_schema_insert AFTER INSERT ON game_entities WHEN NEW.kind='character' BEGIN
 INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at) VALUES(NEW.timeline_id,NEW.id,10,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
END;
CREATE TRIGGER character_profile_schema_update AFTER UPDATE OF data_json,updated_at ON game_entities WHEN NEW.kind='character' BEGIN
 INSERT INTO character_profile_schema_versions(timeline_id,character_id,schema_version,updated_at) VALUES(NEW.timeline_id,NEW.id,10,NEW.updated_at) ON CONFLICT(timeline_id,character_id) DO UPDATE SET schema_version=excluded.schema_version,updated_at=excluded.updated_at;
END;
