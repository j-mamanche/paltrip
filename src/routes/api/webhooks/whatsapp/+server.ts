import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleWhatsAppMessage } from '$lib/server/whatsapp-bot';
import type { RequestHandler } from './$types';

// Meta webhook verification
export const GET: RequestHandler = ({ url }) => {
  const mode      = url.searchParams.get('hub.mode');
  const token     = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
};

// Incoming messages
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);

  // Acknowledge immediately — Meta requires a fast 200
  processWebhook(body).catch((err) => console.error('[WhatsApp webhook]', err));

  return json({ status: 'ok' });
};

async function processWebhook(body: unknown): Promise<void> {
  const entries = (body as { entry?: unknown[] })?.entry ?? [];

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const messages: unknown[] = (change as { value?: { messages?: unknown[] } })?.value?.messages ?? [];

      for (const msg of messages) {
        const m   = msg as Record<string, unknown>;
        const phone = m.from as string;
        if (!phone) continue;

        const type = m.type as string;

        if (type === 'text') {
          const text = (m.text as { body?: string })?.body ?? '';
          await handleWhatsAppMessage(phone, 'text', text, null);
        } else if (type === 'interactive') {
          const interactive = m.interactive as { type: string; button_reply?: { id: string }; list_reply?: { id: string } };
          const interactiveId =
            interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? null;
          if (interactiveId) {
            await handleWhatsAppMessage(phone, 'interactive', null, interactiveId);
          }
        }
        // Ignore status updates, reactions, etc.
      }
    }
  }
}
