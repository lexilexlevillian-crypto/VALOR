-- System 14: structured propositions, episodic memory state, and immutable lore versions.
ALTER TABLE world_facts ADD COLUMN object_id TEXT;
ALTER TABLE world_facts ADD COLUMN qualifiers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(qualifiers_json));
ALTER TABLE world_facts ADD COLUMN source TEXT NOT NULL DEFAULT 'simulation';
ALTER TABLE world_facts ADD COLUMN truth_status TEXT NOT NULL DEFAULT 'verified' CHECK(truth_status IN ('verified','asserted','disputed','false','superseded'));
ALTER TABLE world_facts ADD COLUMN audience_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(audience_json));
ALTER TABLE world_facts ADD COLUMN confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1);
ALTER TABLE world_facts ADD COLUMN observed_at TEXT;
ALTER TABLE world_facts ADD COLUMN learned_at TEXT;
ALTER TABLE world_facts ADD COLUMN valid_from TEXT;
ALTER TABLE world_facts ADD COLUMN valid_until TEXT;
ALTER TABLE world_facts ADD COLUMN event_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(event_ids_json));
ALTER TABLE world_facts ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json));
ALTER TABLE world_facts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json));
UPDATE world_facts SET observed_at=created_at,valid_from=created_at,event_ids_json=json_array(source_event_id);

ALTER TABLE character_knowledge ADD COLUMN confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1);
ALTER TABLE character_knowledge ADD COLUMN observed_at TEXT;
ALTER TABLE character_knowledge ADD COLUMN expires_at TEXT;
ALTER TABLE character_knowledge ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json));

ALTER TABLE character_beliefs ADD COLUMN subject_id TEXT;
ALTER TABLE character_beliefs ADD COLUMN predicate TEXT NOT NULL DEFAULT 'believes';
ALTER TABLE character_beliefs ADD COLUMN object_id TEXT;
ALTER TABLE character_beliefs ADD COLUMN value_json TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(value_json));
ALTER TABLE character_beliefs ADD COLUMN qualifiers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(qualifiers_json));
ALTER TABLE character_beliefs ADD COLUMN truth_status TEXT NOT NULL DEFAULT 'believed' CHECK(truth_status IN ('believed','doubted','disproven','confirmed'));
ALTER TABLE character_beliefs ADD COLUMN audience_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(audience_json));
ALTER TABLE character_beliefs ADD COLUMN observed_at TEXT;
ALTER TABLE character_beliefs ADD COLUMN valid_from TEXT;
ALTER TABLE character_beliefs ADD COLUMN valid_until TEXT;
ALTER TABLE character_beliefs ADD COLUMN event_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(event_ids_json));
ALTER TABLE character_beliefs ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json));
ALTER TABLE character_beliefs ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json));

ALTER TABLE character_memories ADD COLUMN interpretation TEXT NOT NULL DEFAULT '';
ALTER TABLE character_memories ADD COLUMN privacy TEXT NOT NULL DEFAULT 'private' CHECK(privacy IN ('private','shared'));
ALTER TABLE character_memories ADD COLUMN recall_conditions_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(recall_conditions_json));
ALTER TABLE character_memories ADD COLUMN last_refreshed_at TEXT;
ALTER TABLE character_memories ADD COLUMN refresh_count INTEGER NOT NULL DEFAULT 0 CHECK(refresh_count>=0);
ALTER TABLE character_memories ADD COLUMN expires_at TEXT;
ALTER TABLE character_memories ADD COLUMN event_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(event_refs_json));
ALTER TABLE character_memories ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json));
UPDATE character_memories SET interpretation=text,privacy=CASE WHEN private=1 THEN 'private' ELSE 'shared' END,last_refreshed_at=created_at,event_refs_json=json_array(source_event_id);

CREATE TABLE lore_versions (
 timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
 entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 kind TEXT NOT NULL CHECK(kind IN ('lore','storycard')),
 name TEXT NOT NULL,
 visibility TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 archived_at TEXT,
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(timeline_id,entity_id,revision),
 FOREIGN KEY(timeline_id,entity_id) REFERENCES game_entities(timeline_id,id) ON DELETE CASCADE
) STRICT;

INSERT INTO lore_versions(timeline_id,entity_id,revision,kind,name,visibility,data_json,archived_at,recorded_at)
SELECT timeline_id,id,revision,kind,name,visibility,data_json,archived_at,updated_at FROM game_entities WHERE kind IN ('lore','storycard');

CREATE TRIGGER lore_versions_insert AFTER INSERT ON game_entities WHEN NEW.kind IN ('lore','storycard')
BEGIN
 INSERT INTO lore_versions VALUES (NEW.timeline_id,NEW.id,NEW.revision,NEW.kind,NEW.name,NEW.visibility,NEW.data_json,NEW.archived_at,NEW.updated_at);
END;
CREATE TRIGGER lore_versions_update AFTER UPDATE OF name,visibility,data_json,revision,archived_at ON game_entities WHEN NEW.kind IN ('lore','storycard')
BEGIN
 INSERT INTO lore_versions VALUES (NEW.timeline_id,NEW.id,NEW.revision,NEW.kind,NEW.name,NEW.visibility,NEW.data_json,NEW.archived_at,NEW.updated_at);
END;
CREATE TRIGGER lore_versions_immutable_update BEFORE UPDATE ON lore_versions BEGIN SELECT RAISE(ABORT,'immutable lore version'); END;
CREATE TRIGGER lore_versions_immutable_delete BEFORE DELETE ON lore_versions WHEN EXISTS(SELECT 1 FROM game_entities WHERE timeline_id=OLD.timeline_id AND id=OLD.entity_id) BEGIN SELECT RAISE(ABORT,'immutable lore version'); END;

CREATE INDEX lore_versions_timeline_entity ON lore_versions(timeline_id,entity_id,revision);
CREATE INDEX facts_structured_lookup ON world_facts(timeline_id,subject_id,predicate,valid_from,valid_until);
CREATE INDEX beliefs_observer_validity ON character_beliefs(timeline_id,observer_id,valid_from,valid_until);
CREATE INDEX memories_observer_refresh ON character_memories(timeline_id,observer_id,last_refreshed_at);
