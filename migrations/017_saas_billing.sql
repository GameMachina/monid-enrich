CREATE TABLE IF NOT EXISTS enrichable.stripe_customers (
  workspace_id text PRIMARY KEY REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichable.workspace_subscriptions (
  workspace_id text PRIMARY KEY REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  subscription_id text NOT NULL UNIQUE,
  price_id text,
  status text NOT NULL,
  current_period_end bigint,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_customer ON enrichable.workspace_subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS enrichable.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
