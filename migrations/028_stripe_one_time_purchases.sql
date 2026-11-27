CREATE TABLE IF NOT EXISTS enrichable.stripe_one_time_purchases (
  session_id text PRIMARY KEY,
  workspace_id text REFERENCES enrichable.workspaces(id) ON DELETE SET NULL,
  customer_id text,
  payment_intent_id text UNIQUE,
  payment_link_id text,
  buyer_email text,
  amount_total integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('unpaid','paid','refunded','disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_one_time_purchases_workspace_status
  ON enrichable.stripe_one_time_purchases(workspace_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS stripe_one_time_purchases_buyer_email
  ON enrichable.stripe_one_time_purchases(lower(buyer_email),status) WHERE workspace_id IS NULL;

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
  'workspace.billing.subscription_updated',
  'workspace.billing.purchase_updated'
));
