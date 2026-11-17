-- B-12: sync between local installs and the cloud (spec, Data; plan, Data changes). Additive;
-- 0001 and 0002 are untouched. Both modes run it: `cloud_revision` and `pushed_seq` stay unused
-- on the cloud, `purged_through` locally.
ALTER TABLE profiles ADD COLUMN change_seq INTEGER NOT NULL DEFAULT 0;    -- both modes: the last write's counter
ALTER TABLE profiles ADD COLUMN cloud_revision INTEGER;                  -- local: the cloud revision last matched; NULL = never
ALTER TABLE profiles ADD COLUMN pushed_seq INTEGER NOT NULL DEFAULT 0;    -- local: the change_seq the cloud last accepted
ALTER TABLE profiles ADD COLUMN conflict_copy INTEGER NOT NULL DEFAULT 0; -- 1: a copy made by a sync conflict
CREATE INDEX profiles_change_seq ON profiles (change_seq);

-- A delete's record (SD8): written in the delete's own transaction.
CREATE TABLE profile_tombstones (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  revision    INTEGER NOT NULL,                  -- the revision it was deleted at
  deleted_at  TEXT NOT NULL,                     -- ISO-8601 UTC, the deleting side's clock
  change_seq  INTEGER NOT NULL
);
CREATE INDEX profile_tombstones_change_seq ON profile_tombstones (change_seq);

-- Backfill: existing rows get counters 1..n in rowid order; the counter starts after them, so
-- every row written before 0003 counts as unsynced on a local install (cloud_revision NULL).
UPDATE profiles SET change_seq = (SELECT COUNT(*) FROM profiles p WHERE p.rowid <= profiles.rowid);
INSERT INTO app_meta (key, value) VALUES
  ('change_counter', (SELECT CAST(COUNT(*) AS TEXT) FROM profiles)),
  ('sync_cursor', '0'),
  ('purged_through', '0');
