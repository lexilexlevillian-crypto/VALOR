-- System 02: auditable privileged mutation context.
-- Additive only. Existing audit rows remain valid with NULL context fields.
ALTER TABLE audit_log ADD COLUMN request_id TEXT;
ALTER TABLE audit_log ADD COLUMN reason TEXT;
ALTER TABLE audit_log ADD COLUMN before_json TEXT;
ALTER TABLE audit_log ADD COLUMN after_json TEXT;

CREATE INDEX audits_request ON audit_log(request_id);

