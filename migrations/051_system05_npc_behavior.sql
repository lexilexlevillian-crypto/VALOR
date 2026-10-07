-- Private, branch-local behavior projection. The immutable game event and save
-- ledgers retain historical profiles, attempts, decisions and cause deduplication.
CREATE TABLE timeline_npc_behavior (
 timeline_id TEXT PRIMARY KEY REFERENCES timelines(id),
 state_json TEXT NOT NULL CHECK(json_valid(state_json))
);

CREATE TABLE npc_planner_requests (
 id TEXT PRIMARY KEY,
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 actor_id TEXT NOT NULL,
 base_revision INTEGER NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL
);
