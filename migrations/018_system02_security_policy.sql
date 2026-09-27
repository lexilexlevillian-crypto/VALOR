-- System 02 completion: optional audit notes and deliberate deletion reports.
ALTER TABLE audit_log ADD COLUMN note TEXT;

CREATE TABLE deletion_reports (
 id TEXT PRIMARY KEY,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
 scope_type TEXT NOT NULL CHECK(scope_type IN ('world','campaign')),
 scope_id TEXT NOT NULL,
 target_type TEXT NOT NULL CHECK(target_type IN ('record')),
 target_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
 dependency_hash TEXT NOT NULL CHECK(length(dependency_hash)=64),
 hard_delete_allowed INTEGER NOT NULL CHECK(hard_delete_allowed IN (0,1)),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_at TEXT
) STRICT;

CREATE INDEX deletion_reports_target ON deletion_reports(scope_type,scope_id,target_type,target_id,created_at);
CREATE TRIGGER deletion_reports_no_delete BEFORE DELETE ON deletion_reports BEGIN SELECT RAISE(ABORT,'immutable deletion report'); END;
CREATE TRIGGER deletion_reports_fixed_identity BEFORE UPDATE OF id,schema_version,scope_type,scope_id,target_type,target_id,created_by,dependencies_json,dependency_hash,hard_delete_allowed,created_at,expires_at ON deletion_reports BEGIN SELECT RAISE(ABORT,'immutable deletion report'); END;

INSERT INTO schema_compatibility VALUES
 ('security-policy',1,1,1,'archive by default; hard deletion requires an unexpired dependency report and exact confirmation',CURRENT_TIMESTAMP);

CREATE TRIGGER artifact_schema_deletion_report_insert AFTER INSERT ON deletion_reports BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions
 VALUES ('deletion_report',NEW.id,NEW.scope_type,NEW.scope_id,NEW.schema_version,NEW.created_at);
END;
