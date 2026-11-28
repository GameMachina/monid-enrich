CREATE TABLE IF NOT EXISTS enrichable.sheet_folders (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sheet_folders_name_unique
  ON enrichable.sheet_folders (workspace_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS sheet_folders_one_default
  ON enrichable.sheet_folders (workspace_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS sheet_folders_workspace_order
  ON enrichable.sheet_folders (workspace_id, is_default DESC, created_at, id);

-- Existing sheets keep their IDs, rows, and contents. Only organization metadata is added.
INSERT INTO enrichable.sheet_folders (workspace_id, id, name, is_default, created_at, updated_at)
SELECT id, 'my-sheets', 'My Sheets', true,
       (extract(epoch FROM now()) * 1000)::bigint,
       (extract(epoch FROM now()) * 1000)::bigint
FROM enrichable.workspaces
ON CONFLICT (workspace_id, id) DO NOTHING;

UPDATE enrichable.sheets
SET data = jsonb_set(data, '{folderId}', to_jsonb('my-sheets'::text), true)
WHERE data->>'folderId' IS NULL;
