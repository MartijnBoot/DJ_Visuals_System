CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('schema_created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
