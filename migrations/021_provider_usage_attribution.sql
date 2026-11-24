-- Attribute provider receipts to the workspace member and spreadsheet cell that initiated the run.
-- Historical receipts remain unattributed; no row contents or prompts are copied into the usage ledger.
ALTER TABLE enrichable.monid_runs ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE enrichable.monid_runs ADD COLUMN IF NOT EXISTS sheet_id text;
ALTER TABLE enrichable.monid_runs ADD COLUMN IF NOT EXISTS row_id text;
ALTER TABLE enrichable.monid_runs ADD COLUMN IF NOT EXISTS column_id text;

ALTER TABLE enrichable.treg_runs ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE enrichable.treg_runs ADD COLUMN IF NOT EXISTS sheet_id text;
ALTER TABLE enrichable.treg_runs ADD COLUMN IF NOT EXISTS row_id text;
ALTER TABLE enrichable.treg_runs ADD COLUMN IF NOT EXISTS column_id text;

CREATE INDEX IF NOT EXISTS monid_runs_workspace_actor_time ON enrichable.monid_runs (workspace_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monid_runs_workspace_sheet_time ON enrichable.monid_runs (workspace_id, sheet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS treg_runs_workspace_actor_time ON enrichable.treg_runs (workspace_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS treg_runs_workspace_sheet_time ON enrichable.treg_runs (workspace_id, sheet_id, created_at DESC);
