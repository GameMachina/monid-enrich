ALTER TABLE enrichable.workspace_audit_events DROP CONSTRAINT IF EXISTS workspace_audit_events_action_check;
ALTER TABLE enrichable.workspace_audit_events ADD CONSTRAINT workspace_audit_events_action_check CHECK (action IN (
  'workspace.export',
  'workspace.close',
  'workspace.settings.update',
  'workspace.settings.import',
  'workspace.mcp_key.create',
  'workspace.mcp_key.rotate',
  'workspace.member.added',
  'workspace.member.updated',
  'workspace.member.removed',
  'workspace.invitation.created',
  'workspace.invitation.accepted',
  'workspace.invitation.revoked'
));

CREATE TABLE IF NOT EXISTS enrichable.clerk_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
