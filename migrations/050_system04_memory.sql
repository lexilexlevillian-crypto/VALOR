-- Canonical source records remain independent of subjective retention and mutation.
ALTER TABLE character_memories ADD COLUMN cognition_json TEXT CHECK(cognition_json IS NULL OR json_valid(cognition_json));
CREATE INDEX memory_owner_time ON character_memories(timeline_id,observer_id,created_at);
CREATE INDEX memory_source_owner ON character_memories(timeline_id,source_event_id,observer_id);
CREATE INDEX memory_status_type ON character_memories(timeline_id,observer_id,json_extract(cognition_json,'$.status'),json_extract(cognition_json,'$.type'));
