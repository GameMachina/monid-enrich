CREATE TABLE IF NOT EXISTS enrichable.account_first_workspaces (
  issuer text NOT NULL,
  user_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, user_id)
);

CREATE TABLE IF NOT EXISTS enrichable.workspace_trial_usage (
  workspace_id text PRIMARY KEY REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  trial_eligible boolean NOT NULL DEFAULT true,
  admin_exempt boolean NOT NULL DEFAULT false,
  sheets_used integer NOT NULL DEFAULT 0 CHECK (sheets_used >= 0),
  rows_used integer NOT NULL DEFAULT 0 CHECK (rows_used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_first_workspaces_workspace
  ON enrichable.account_first_workspaces(workspace_id);

-- Preserve an existing user's earliest known workspace when the app already recorded activity.
-- New accounts without historical activity are assigned their first workspace on first use.
WITH activity AS (
  SELECT w.issuer,a.actor_id AS user_id,w.id AS workspace_id,a.created_at AS used_at
  FROM enrichable.workspace_audit_events a
  JOIN enrichable.workspaces w ON w.id=a.workspace_id
  WHERE a.actor_id <> 'mcp' AND a.actor_id NOT LIKE 'system:%'
  UNION ALL
  SELECT w.issuer,s.created_by AS user_id,w.id AS workspace_id,
    CASE WHEN s.data->>'createdAt' ~ '^[0-9]+$'
      THEN to_timestamp((s.data->>'createdAt')::double precision / 1000)
      ELSE now()
    END AS used_at
  FROM enrichable.sheets s
  JOIN enrichable.workspaces w ON w.id=s.workspace_id
  WHERE s.created_by <> 'mcp' AND s.created_by NOT LIKE 'system:%'
), earliest AS (
  SELECT DISTINCT ON (issuer,user_id) issuer,user_id,workspace_id
  FROM activity
  WHERE user_id IS NOT NULL AND user_id <> ''
  ORDER BY issuer,user_id,used_at,workspace_id
)
INSERT INTO enrichable.account_first_workspaces (issuer,user_id,workspace_id)
SELECT issuer,user_id,workspace_id FROM earliest
ON CONFLICT (issuer,user_id) DO NOTHING;

INSERT INTO enrichable.workspace_trial_usage (workspace_id,trial_eligible,sheets_used,rows_used)
SELECT DISTINCT f.workspace_id,true,
  (SELECT count(*)::int FROM enrichable.sheets s WHERE s.workspace_id=f.workspace_id),
  (SELECT count(*)::int FROM enrichable.sheet_rows r WHERE r.workspace_id=f.workspace_id AND EXISTS (
    SELECT 1 FROM jsonb_each(r.data->'cells') cell
    WHERE cell.value->'v' IS NOT NULL AND cell.value->'v' <> 'null'::jsonb AND cell.value->>'v' <> ''
      AND NOT (jsonb_typeof(cell.value->'v')='array' AND cell.value->'v'='[]'::jsonb)
  ))
FROM enrichable.account_first_workspaces f
ON CONFLICT (workspace_id) DO NOTHING;
