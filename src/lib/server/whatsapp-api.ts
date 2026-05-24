import { env } from '$env/dynamic/private';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

export type WaButton  = { id: string; title: string };
export type WaRow     = { id: string; title: string; description?: string };
export type WaSection = { title?: string; rows: WaRow[] };

export async function waSend(to: string, text: string): Promise<void> {
  await waPost(to, { type: 'text', text: { body: text, preview_url: false } });
}

export async function waButtons(
  to: string,
  body: string,
  buttons: WaButton[],
  header?: string
): Promise<void> {
  await waPost(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header && { header: { type: 'text', text: header } }),
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) }
        }))
      }
    }
  });
}

export async function waList(
  to: string,
  body: string,
  buttonText: string,
  sections: WaSection[],
  header?: string
): Promise<void> {
  await waPost(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header && { header: { type: 'text', text: header } }),
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: sections.map((s) => ({
          ...(s.title && { title: s.title }),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            ...(r.description && { description: r.description.slice(0, 72) })
          }))
        }))
      }
    }
  });
}

async function waPost(to: string, payload: object): Promise<void> {
  const res = await fetch(`${GRAPH_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[WhatsApp API]', res.status, err);
    throw new Error(`WhatsApp API ${res.status}`);
  }
}
