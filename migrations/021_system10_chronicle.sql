ALTER TABLE story_turns ADD COLUMN notices_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(notices_json));
ALTER TABLE story_turns ADD COLUMN scene_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scene_json));

ALTER TABLE archived_chronicle ADD COLUMN notices_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(notices_json));
ALTER TABLE archived_chronicle ADD COLUMN scene_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scene_json));
