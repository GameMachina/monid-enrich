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
  'workspace.invitation.revoked',
  'workspace.credentials.reencrypted',
  'workspace.provider_connection.added',
  'workspace.provider_connection.removed',
  'workspace.provider_connection.renamed',
  'workspace.provider_connection.oauth_started',
  'workspace.provider_connection.extra_credential_added',
  'workspace.provider_connection.updated',
  'workspace.provider_billing.topup_started',
  'workspace.billing.checkout_started',
  'workspace.billing.portal_opened',
  'workspace.billing.subscription_updated'
));

CREATE TABLE IF NOT EXISTS enrichable.clerk_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
