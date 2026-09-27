-- One-time deployment grant requested for the named VALOR owner account.
-- Promote only this existing player account; never broaden Developer Mode globally.
-- The audit row has no human actor because this is a deployment migration.
INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason,before_json,after_json)
SELECT lower(hex(randomblob(16))),NULL,'account.role.granted',id,CURRENT_TIMESTAMP,
       'migration-016-developer-access','user-requested-developer-access',
       json_object('role',role),json_object('role','creator')
FROM users
WHERE email='lexlexlevillian@gmail.com' COLLATE NOCASE
  AND archived_at IS NULL
  AND role='player';

UPDATE users
SET role='creator',revision=revision+1,updated_at=CURRENT_TIMESTAMP
WHERE email='lexlexlevillian@gmail.com' COLLATE NOCASE
  AND archived_at IS NULL
  AND role='player';