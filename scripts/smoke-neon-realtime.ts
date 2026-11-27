import { createRealtimeClient } from '@neon/realtime/client';

const origin = (process.env.ENRICHABLE_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
async function main() {
  const page = await fetch(`${origin}/app`, { redirect: 'manual' });
  const setCookie = page.headers.get('set-cookie');
  if (!setCookie || page.status < 300 || page.status >= 400) throw new Error('Could not initialize a local workspace session.');
  const cookie = setCookie.split(';', 1)[0];

  const sessionResponse = await fetch(`${origin}/api/auth/session`, { headers: { cookie } });
  if (!sessionResponse.ok) throw new Error(`Local workspace session returned HTTP ${sessionResponse.status}.`);
  const session = await sessionResponse.json() as { partition?: string; sessionId?: string };
  if (!session.partition || !session.sessionId) throw new Error('Local workspace session is incomplete.');

  const headers = { cookie, 'x-enrichable-account': session.partition, 'x-enrichable-session': session.sessionId };
  const bundleResponse = await fetch(`${origin}/api/realtime`, { headers, cache: 'no-store' });
  if (!bundleResponse.ok) throw new Error(`App Realtime endpoint returned HTTP ${bundleResponse.status}.`);
  const bundle = await bundleResponse.json() as { enabled?: boolean; url?: string; index?: unknown };
  if (!bundle.enabled || !bundle.url || !bundle.index) throw new Error('App did not return an enabled Realtime subscription.');

  const client = createRealtimeClient({ url: bundle.url });
  const subscription = client.subscribe(bundle.index as Parameters<typeof client.subscribe>[0]);
  let stop: (() => void) | undefined;
  try {
    const rowCount = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime subscription timed out.')), 20_000);
      stop = subscription.onChange((snapshot) => {
        if (snapshot.status === 'error') {
          clearTimeout(timeout);
          reject(new Error('Realtime subscription entered an error state.'));
        } else if (snapshot.status === 'live' && Array.isArray(snapshot.data)) {
          clearTimeout(timeout);
          resolve(snapshot.data.length);
        }
      });
    });
    return `App Realtime smoke passed: subscription live; ${rowCount} workspace sheet rows received.`;
  } finally {
    stop?.();
    subscription.unsubscribe();
    client.close();
  }
}

void main().then(
  (message) => process.stdout.write(`${message}\n`, () => process.exit(0)),
  (error: unknown) => process.stderr.write(`${error instanceof Error ? error.message : 'Realtime smoke failed.'}\n`, () => process.exit(1)),
);
