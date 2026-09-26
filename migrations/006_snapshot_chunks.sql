-- New saves reuse immutable compressed blocks. Existing saves remain untouched.
CREATE TABLE snapshot_chunks (
 hash TEXT PRIMARY KEY,
 payload TEXT NOT NULL
) STRICT;
CREATE TRIGGER snapshot_chunks_immutable_update BEFORE UPDATE ON snapshot_chunks BEGIN SELECT RAISE(ABORT,'immutable snapshot chunk'); END;
CREATE TRIGGER snapshot_chunks_immutable_delete BEFORE DELETE ON snapshot_chunks BEGIN SELECT RAISE(ABORT,'immutable snapshot chunk'); END;
