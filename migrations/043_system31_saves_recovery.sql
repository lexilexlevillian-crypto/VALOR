-- System 31: save manifests, committed cursor lineage, import previews, and campaign duplication lineage.
CREATE TABLE save_manifests (
 save_id TEXT PRIMARY KEY REFERENCES saves(id),
 campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 snapshot_version INTEGER NOT NULL CHECK(snapshot_version>0),
 projection_version INTEGER NOT NULL CHECK(projection_version>0),
 clock TEXT NOT NULL,
 event_cursor TEXT NOT NULL,
 event_revision INTEGER NOT NULL CHECK(event_revision>0),
 event_id TEXT,
 content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
 envelope_checksum TEXT NOT NULL CHECK(length(envelope_checksum)=64),
 dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
 media_strategy TEXT NOT NULL CHECK(media_strategy IN ('inline','references','omit')),
 thumbnail_media_id TEXT,
 checkpoint TEXT NOT NULL CHECK(checkpoint IN ('manual','safe-commit','before-death','branch-origin','import-origin','recovery')),
 compatibility_json TEXT NOT NULL CHECK(json_valid(compatibility_json)),
 created_at TEXT NOT NULL
) STRICT;

CREATE TABLE timeline_commit_history (
 timeline_id TEXT NOT NULL REFERENCES timelines(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 cursor TEXT NOT NULL,
 event_id TEXT,
 save_id TEXT REFERENCES saves(id),
 state_checksum TEXT NOT NULL CHECK(length(state_checksum)=64),
 committed_at TEXT NOT NULL,
 PRIMARY KEY(timeline_id,revision),
 UNIQUE(timeline_id,cursor)
) STRICT;

INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at)
SELECT t.id,t.revision,c.cursor,NULL,NULL,lower(hex(randomblob(32))),c.updated_at
FROM timelines t JOIN timeline_turn_cursors c ON c.timeline_id=t.id;

CREATE TABLE import_previews (
 token TEXT PRIMARY KEY,
 target_timeline_id TEXT NOT NULL REFERENCES timelines(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 bundle_checksum TEXT NOT NULL CHECK(length(bundle_checksum)=64),
 report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
) STRICT;

CREATE TABLE campaign_duplicate_lineage (
 child_campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
 parent_campaign_id TEXT NOT NULL REFERENCES campaigns(id),
 source_timeline_id TEXT NOT NULL REFERENCES timelines(id),
 child_timeline_id TEXT NOT NULL REFERENCES timelines(id),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER save_manifests_no_update BEFORE UPDATE ON save_manifests BEGIN SELECT RAISE(ABORT,'immutable save manifest'); END;
CREATE TRIGGER save_manifests_no_delete BEFORE DELETE ON save_manifests BEGIN SELECT RAISE(ABORT,'immutable save manifest'); END;
CREATE TRIGGER timeline_commit_history_no_update BEFORE UPDATE ON timeline_commit_history BEGIN SELECT RAISE(ABORT,'immutable commit history'); END;
CREATE TRIGGER timeline_commit_history_no_delete BEFORE DELETE ON timeline_commit_history BEGIN SELECT RAISE(ABORT,'immutable commit history'); END;

CREATE INDEX save_manifests_cursor ON save_manifests(timeline_id,event_revision,event_cursor);
CREATE INDEX timeline_commit_event ON timeline_commit_history(timeline_id,event_id);
CREATE INDEX import_previews_target ON import_previews(target_timeline_id,actor_id,expires_at);
