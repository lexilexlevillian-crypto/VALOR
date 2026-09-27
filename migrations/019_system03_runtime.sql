-- Repair migration 010 without changing its checksum.
UPDATE campaign_configurations SET defaults_json=json_set(defaults_json,'$.saveBehavior.branchOnDeath',json('true')) WHERE json_type(defaults_json,'$.saveBehavior.branchOnDeath')='integer';
UPDATE canon_records SET archived_at=updated_at WHERE source_status='archived' AND archived_at IS NULL;
CREATE TABLE timeline_canon_sources (timeline_id TEXT PRIMARY KEY REFERENCES timelines(id),source_json TEXT NOT NULL CHECK(json_valid(source_json))) STRICT;
CREATE TRIGGER timeline_canon_sources_no_update BEFORE UPDATE ON timeline_canon_sources BEGIN SELECT RAISE(ABORT,'immutable timeline canon'); END;
CREATE TRIGGER timeline_canon_sources_no_delete BEFORE DELETE ON timeline_canon_sources BEGIN SELECT RAISE(ABORT,'immutable timeline canon'); END;
CREATE TRIGGER timeline_canon_binding_no_update BEFORE UPDATE ON timeline_canon_bindings BEGIN SELECT RAISE(ABORT,'immutable timeline canon'); END;
CREATE TRIGGER timeline_canon_binding_no_delete BEFORE DELETE ON timeline_canon_bindings BEGIN SELECT RAISE(ABORT,'immutable timeline canon'); END;
CREATE TRIGGER event_canon_binding_no_update BEFORE UPDATE ON event_canon_bindings BEGIN SELECT RAISE(ABORT,'immutable event canon'); END;
CREATE TRIGGER event_canon_binding_no_delete BEFORE DELETE ON event_canon_bindings BEGIN SELECT RAISE(ABORT,'immutable event canon'); END;
CREATE TABLE event_world_context (event_id TEXT PRIMARY KEY REFERENCES game_events(id),canon_revision_id TEXT REFERENCES canon_revisions(id),configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json))) STRICT;
CREATE TRIGGER event_world_context_no_update BEFORE UPDATE ON event_world_context BEGIN SELECT RAISE(ABORT,'immutable event world context'); END;
CREATE TRIGGER event_world_context_no_delete BEFORE DELETE ON event_world_context BEGIN SELECT RAISE(ABORT,'immutable event world context'); END;
CREATE TABLE timeline_world_history (timeline_id TEXT PRIMARY KEY REFERENCES timelines(id),history_json TEXT NOT NULL CHECK(json_valid(history_json))) STRICT;
CREATE TRIGGER timeline_world_history_no_update BEFORE UPDATE ON timeline_world_history BEGIN SELECT RAISE(ABORT,'immutable inherited world history'); END;
CREATE TRIGGER timeline_world_history_no_delete BEFORE DELETE ON timeline_world_history BEGIN SELECT RAISE(ABORT,'immutable inherited world history'); END;
