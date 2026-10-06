-- Canonical information records are timeline local and included in save snapshots.
CREATE TABLE timeline_information (
 timeline_id TEXT PRIMARY KEY REFERENCES timelines(id) ON DELETE CASCADE,
 state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
CREATE TABLE information_context_manifests (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
 viewer_id TEXT NOT NULL,
 purpose TEXT NOT NULL,
 state_version INTEGER NOT NULL,
 event_cursor TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX information_manifest_viewer ON information_context_manifests(timeline_id,viewer_id,state_version);
