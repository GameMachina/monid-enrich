ALTER TABLE enrichable.workspace_audit_events DROP CONSTRAINT IF EXISTS workspace_audit_events_action_check;
ALTER TABLE enrichable.workspace_audit_events ADD CONSTRAINT workspace_audit_events_action_check CHECK (action IN (
  'workspace.export',
  'workspace.close',
  'workspace.settings.update',
  'workspace.settings.import',
  'workspace.mcp_key.create',
  'workspace.mcp_key.rotate'
));
