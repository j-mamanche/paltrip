import { supabase } from './supabase';
import { waSend, waButtons, waList } from './whatsapp-api';
import type { WaButton } from './whatsapp-api';
import { computeBalances, optimizeTransfers } from '$lib/engines/balance';
import type { Expense } from '$lib/types';

// ── Types ──────────────────────────────────────────────────────────────────

type Step =
  | 'idle'
  | 'awaiting_trip_code'
  | 'awaiting_member'
  | 'menu'
  | 'exp_amount'
  | 'exp_paid_by'
  | 'exp_split'
  | 'exp_participants'
  | 'exp_confirm';

interface SessionContext {
  // Registration
  member_options?: { id: string; name: string }[];
  // Expense in progress
  exp_amount?: number;
  exp_description?: string;
  exp_paid_by?: string;
  exp_split?: 'equal' | 'selected';
  exp_participants?: string[];  // undefined = all members
  exp_member_options?: { id: string; name: string }[];
}

interface WaSession {
  phone: string;
  trip_id: string | null;
  member_id: string | null;
  step: Step;
  context: SessionContext;
  updated_at: string;
}

type Member = { id: string; name: string; payment_ref?: string | null };

// ── Entry point ────────────────────────────────────────────────────────────

export async function handleWhatsAppMessage(
  phone: string,
  type: 'text' | 'interactive',
  text: string | null,
  interactiveId: string | null
): Promise<void> {
  const session = await getOrCreateSession(phone);

  try {
    await dispatch(phone, session, type, text, interactiveId);
  } catch (err) {
    console.error('[WhatsApp bot]', err);
    await waSend(phone, 'Ocurrió un error. Enviá *menú* para volver al inicio.');
  }
}

// ── Session ────────────────────────────────────────────────────────────────

async function getOrCreateSession(phone: string): Promise<WaSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select()
    .eq('phone', phone)
    .single();

  if (data) {
    // Reset stale mid-expense sessions (> 4 h)
    const expSteps: Step[] = ['exp_amount', 'exp_paid_by', 'exp_split', 'exp_participants', 'exp_confirm'];
    const stale = Date.now() - new Date(data.updated_at).getTime() > 4 * 3600 * 1000;
    if (stale && expSteps.includes(data.step as Step)) {
      const reset = { step: data.trip_id ? 'menu' : 'idle', context: {} } as const;
      await supabase.from('whatsapp_sessions').update(reset).eq('phone', phone);
      return { ...data, ...reset } as WaSession;
    }
    return data as WaSession;
  }

  const fresh: Omit<WaSession, 'updated_at'> = {
    phone, trip_id: null, member_id: null, step: 'idle', context: {}
  };
  await supabase.from('whatsapp_sessions').insert({ ...fresh, updated_at: new Date().toISOString() });
  return { ...fresh, updated_at: new Date().toISOString() };
}

async function saveSession(phone: string, updates: Partial<Omit<WaSession, 'phone'>>): Promise<void> {
  await supabase
    .from('whatsapp_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

async function dispatch(
  phone: string,
  session: WaSession,
  type: 'text' | 'interactive',
  text: string | null,
  interactiveId: string | null
): Promise<void> {
  const rawText = text?.trim() ?? '';
  const inputId  = interactiveId ?? rawText;
  const inputLow = rawText.toLowerCase();

  // Global: cancel expense in progress
  const expSteps: Step[] = ['exp_amount', 'exp_paid_by', 'exp_split', 'exp_participants', 'exp_confirm'];
  if (expSteps.includes(session.step) && /^(cancelar|cancel|salir|no|exit)$/i.test(inputLow)) {
    await saveSession(phone, { step: 'menu', context: {} });
    await waSend(phone, 'Operación cancelada.');
    await showMenu(phone, { ...session, step: 'menu', context: {} });
    return;
  }

  // Global: jump to menu
  if (/^(menú|menu|hola|inicio|start|0)$/i.test(inputLow)) {
    if (session.trip_id && session.member_id) {
      await showMenu(phone, session);
    } else {
      await askForTripCode(phone);
      await saveSession(phone, { step: 'awaiting_trip_code' });
    }
    return;
  }

  switch (session.step) {
    case 'idle':
    case 'awaiting_trip_code':
      return handleTripCode(phone, session, rawText);

    case 'awaiting_member':
      return handleMemberSelection(phone, session, inputId);

    case 'menu':
      return handleMenu(phone, session, inputLow, inputId);

    case 'exp_amount':
      return handleExpAmount(phone, session, rawText);

    case 'exp_paid_by':
      return handleExpPaidBy(phone, session, inputId, inputLow);

    case 'exp_split':
      return handleExpSplit(phone, session, inputId, inputLow);

    case 'exp_participants':
      return handleExpParticipants(phone, session, rawText);

    case 'exp_confirm':
      return handleExpConfirm(phone, session, inputId, inputLow);

    default:
      await waSend(phone, 'Enviá *menú* para continuar.');
  }
}

// ── Trip registration ──────────────────────────────────────────────────────

async function askForTripCode(phone: string): Promise<void> {
  await waSend(phone,
    "¡Hola! Soy el asistente de *Pa'l* 🧳\n\nEnviame el código de tu viaje para comenzar.\n\n_Lo encontrás en la app, en el botón Compartir del viaje._"
  );
}

async function handleTripCode(phone: string, session: WaSession, text: string): Promise<void> {
  if (!text) {
    await askForTripCode(phone);
    await saveSession(phone, { step: 'awaiting_trip_code' });
    return;
  }

  const token = text.toUpperCase().replace(/\s+/g, '');

  const { data: trip } = await supabase
    .from('trips')
    .select('id, name')
    .eq('access_token', token)
    .single();

  if (!trip) {
    await waSend(phone, 'No encontré un viaje con ese código. Verificá que esté bien escrito y volvé a intentar.');
    return;
  }

  const { data: members } = await supabase
    .from('trip_users')
    .select('id, name')
    .eq('trip_id', trip.id)
    .eq('status', 'active')
    .order('joined_at');

  if (!members?.length) {
    await waSend(phone, 'Este viaje todavía no tiene miembros activos.');
    return;
  }

  // Phone already linked to a member in this trip
  const existing = members.find((m: Member) =>
    m.id && session.member_id // we'll check via DB
  );

  const { data: linked } = await supabase
    .from('trip_users')
    .select('id, name')
    .eq('trip_id', trip.id)
    .eq('phone', phone)
    .single();

  if (linked) {
    await saveSession(phone, { trip_id: trip.id, member_id: linked.id, step: 'menu', context: {} });
    await waSend(phone, `¡Hola de nuevo, *${linked.name}*! Reconecté al viaje *${trip.name}*.`);
    await showMenu(phone, { ...session, trip_id: trip.id, member_id: linked.id, step: 'menu', context: {} });
    return;
  }

  // Need to pick identity
  await saveSession(phone, {
    trip_id: trip.id,
    step: 'awaiting_member',
    context: { member_options: members }
  });

  if (members.length <= 3) {
    await waButtons(
      phone,
      `Encontré el viaje *${trip.name}* 🌴\n¿Cuál es tu nombre?`,
      members.map((m: Member) => ({ id: `member_${m.id}`, title: m.name }))
    );
  } else {
    await waList(
      phone,
      `Encontré el viaje *${trip.name}* 🌴\n¿Cuál es tu nombre?`,
      'Ver miembros',
      [{ rows: members.map((m: Member) => ({ id: `member_${m.id}`, title: m.name })) }]
    );
  }
}

async function handleMemberSelection(phone: string, session: WaSession, inputId: string): Promise<void> {
  const options = session.context.member_options ?? [];

  const selected = findMember(options, inputId, 'member_');
  if (!selected) {
    await waSend(phone, 'No reconocí esa opción. Por favor elegí tu nombre de la lista.');
    return;
  }

  await supabase.from('trip_users').update({ phone }).eq('id', selected.id);
  await saveSession(phone, { member_id: selected.id, step: 'menu', context: {} });

  await waSend(phone, `¡Perfecto, *${selected.name}*! Ya estás conectado. 🎉`);
  await showMenu(phone, { ...session, member_id: selected.id, step: 'menu', context: {} });
}

// ── Main menu ──────────────────────────────────────────────────────────────

async function showMenu(phone: string, session: WaSession): Promise<void> {
  const { data: trip } = await supabase
    .from('trips')
    .select('name, status')
    .eq('id', session.trip_id!)
    .single();

  if (!trip) {
    await waSend(phone, 'No encontré el viaje. Enviame el código para reconectarte.');
    await saveSession(phone, { step: 'awaiting_trip_code', trip_id: null, member_id: null });
    return;
  }

  const closed = trip.status === 'closed';
  const body = `*${trip.name}*${closed ? ' 🔒 _cerrado_' : ''}\n¿Qué hacemos?`;
  const buttons: WaButton[] = closed
    ? [{ id: 'menu_balances', title: 'Ver balances' }, { id: 'menu_resumen', title: 'Resumen' }]
    : [
        { id: 'menu_expense',  title: 'Agregar gasto' },
        { id: 'menu_balances', title: 'Ver balances'  },
        { id: 'menu_resumen',  title: 'Resumen'       }
      ];

  await waButtons(phone, body, buttons);
  await saveSession(phone, { step: 'menu' });
}

async function handleMenu(phone: string, session: WaSession, inputLow: string, inputId: string): Promise<void> {
  if (inputId === 'menu_expense' || inputLow === '1' || /agreg|gasto|nuevo/.test(inputLow)) {
    await saveSession(phone, { step: 'exp_amount', context: {} });
    await waSend(phone,
      '¿Cuánto fue el gasto?\n\nEscribí el monto, y opcionalmente una descripción:\n• *120000*\n• *cena 120000*\n• *taxi para el aeropuerto 45000*'
    );
    return;
  }

  if (inputId === 'menu_balances' || inputLow === '2' || /balance|debe/.test(inputLow)) {
    await sendBalances(phone, session);
    return;
  }

  if (inputId === 'menu_resumen' || inputLow === '3' || /resumen|compartir/.test(inputLow)) {
    await sendResumen(phone, session);
    return;
  }

  await showMenu(phone, session);
}

// ── Expense flow ───────────────────────────────────────────────────────────

async function handleExpAmount(phone: string, session: WaSession, text: string): Promise<void> {
  const { amount, description } = parseAmountInput(text);

  if (!amount || amount <= 0) {
    await waSend(phone, 'No pude leer el monto. Escribilo así:\n• *120000*\n• *cena 120000*\n\nO enviá *cancelar* para salir.');
    return;
  }

  const members = await getTripMembers(session.trip_id!);
  if (!members.length) { await waSend(phone, 'No hay miembros activos en el viaje.'); return; }

  const { data: trip } = await supabase.from('trips').select('currency').eq('id', session.trip_id!).single();
  const formatted = fmt(amount, trip?.currency ?? 'COP');
  const descStr   = description ? `*${description}*` : 'El gasto';

  await saveSession(phone, { step: 'exp_paid_by', context: { exp_amount: amount, exp_description: description } });
  await sendMemberSelection(phone, members, `${descStr} · ${formatted}\n¿Quién pagó?`, 'payer_', 'Elegir pagador');
}

async function handleExpPaidBy(phone: string, session: WaSession, inputId: string, inputLow: string): Promise<void> {
  const members = await getTripMembers(session.trip_id!);
  const selected = findMember(members, inputId, 'payer_') ?? findMember(members, inputLow, '');

  if (!selected) {
    await waSend(phone, 'No reconocí quién pagó. Elegí de la lista:');
    await sendMemberSelection(phone, members, '¿Quién pagó?', 'payer_', 'Elegir pagador');
    return;
  }

  await saveSession(phone, { step: 'exp_split', context: { ...session.context, exp_paid_by: selected.id } });

  await waButtons(phone, '¿Cómo se divide?', [
    { id: 'split_all',  title: 'Entre todos'  },
    { id: 'split_some', title: 'Solo algunos' }
  ]);
}

async function handleExpSplit(phone: string, session: WaSession, inputId: string, inputLow: string): Promise<void> {
  const isAll  = inputId === 'split_all'  || inputLow === '1' || /todos|all|igual/.test(inputLow);
  const isSome = inputId === 'split_some' || inputLow === '2' || /algunos|elegir|selec/.test(inputLow);

  if (isAll) {
    await saveSession(phone, { step: 'exp_confirm', context: { ...session.context, exp_split: 'equal' } });
    await showExpConfirm(phone, { ...session, context: { ...session.context, exp_split: 'equal' } });
    return;
  }

  if (isSome) {
    const members = await getTripMembers(session.trip_id!);
    const list = members.map((m, i) => `${i + 1}. ${m.name}`).join('\n');

    await saveSession(phone, {
      step: 'exp_participants',
      context: { ...session.context, exp_split: 'selected', exp_member_options: members }
    });
    await waSend(phone,
      `¿Quiénes participan?\nRespondé con los números separados por coma:\n\n${list}\n\nEjemplo: *1,3* o escribe *todos* para incluirlos a todos.`
    );
    return;
  }

  await waButtons(phone, '¿Cómo se divide?', [
    { id: 'split_all',  title: 'Entre todos'  },
    { id: 'split_some', title: 'Solo algunos' }
  ]);
}

async function handleExpParticipants(phone: string, session: WaSession, text: string): Promise<void> {
  const options = session.context.exp_member_options ?? await getTripMembers(session.trip_id!);

  let participants: string[];

  if (/todos|all/i.test(text)) {
    participants = options.map((m) => m.id);
  } else {
    const indices = text.split(/[,\s]+/)
      .map((s) => parseInt(s.trim()) - 1)
      .filter((n) => n >= 0 && n < options.length);

    if (!indices.length) {
      await waSend(phone,
        'No entendí la selección. Escribí los números separados por coma (ej: *1,3*) o *todos*.'
      );
      return;
    }
    participants = [...new Set(indices.map((i) => options[i].id))];
  }

  const ctx = { ...session.context, exp_participants: participants };
  await saveSession(phone, { step: 'exp_confirm', context: ctx });
  await showExpConfirm(phone, { ...session, context: ctx });
}

async function showExpConfirm(phone: string, session: WaSession): Promise<void> {
  const ctx     = session.context;
  const members = await getTripMembers(session.trip_id!);
  const { data: trip } = await supabase.from('trips').select('currency').eq('id', session.trip_id!).single();
  const currency = trip?.currency ?? 'COP';

  const payer       = members.find((m) => m.id === ctx.exp_paid_by);
  const participants = ctx.exp_participants
    ? members.filter((m) => ctx.exp_participants!.includes(m.id))
    : members;

  const amount    = ctx.exp_amount ?? 0;
  const perPerson = participants.length > 0 ? amount / participants.length : 0;

  const lines = [
    ctx.exp_description ? `*${ctx.exp_description}*` : '_Sin descripción_',
    `Monto: ${fmt(amount, currency)}`,
    `Pagó: *${payer?.name ?? '?'}*`,
    `${participants.length} persona${participants.length !== 1 ? 's' : ''}: ${participants.map((m) => m.name).join(', ')}`,
    perPerson > 0 ? `→ ${fmt(perPerson, currency)} cada uno` : ''
  ].filter(Boolean);

  await waButtons(phone, lines.join('\n'), [
    { id: 'confirm_save',   title: 'Guardar'   },
    { id: 'confirm_cancel', title: 'Cancelar'  }
  ], '¿Confirmar gasto?');
}

async function handleExpConfirm(phone: string, session: WaSession, inputId: string, inputLow: string): Promise<void> {
  if (inputId === 'confirm_cancel' || /^(no|cancel|cancelar)$/i.test(inputLow)) {
    await saveSession(phone, { step: 'menu', context: {} });
    await waSend(phone, 'Gasto cancelado.');
    await showMenu(phone, { ...session, step: 'menu', context: {} });
    return;
  }

  if (inputId !== 'confirm_save' && !/^(s[ií]|guardar|ok|dale|listo)$/i.test(inputLow)) {
    await showExpConfirm(phone, session);
    return;
  }

  const ctx = session.context;
  const members = await getTripMembers(session.trip_id!);
  const { data: trip } = await supabase.from('trips').select('currency').eq('id', session.trip_id!).single();
  const currency = trip?.currency ?? 'COP';

  const participantIds = ctx.exp_participants ?? members.map((m) => m.id);
  const amount      = ctx.exp_amount ?? 0;
  const description = ctx.exp_description ?? '';
  const paidBy      = ctx.exp_paid_by ?? session.member_id!;
  const category    = detectCategory(description);

  const { data: expense, error: expErr } = await supabase
    .from('expenses')
    .insert({
      trip_id: session.trip_id,
      description,
      amount_total: amount,
      currency,
      original_currency: currency,
      original_amount: amount,
      exchange_rate: 1,
      amount_base: amount,
      paid_by: paidBy,
      settlement_type: 'deferred',
      category,
      split_mode: 'equal',
      tip_amount: 0,
      tip_mode: 'proportional',
      status: 'confirmed'
    })
    .select()
    .single();

  if (expErr || !expense) {
    await waSend(phone, 'Error al guardar el gasto. Intentá de nuevo o usá *cancelar*.');
    return;
  }

  await supabase.from('expense_participants').insert(
    participantIds.map((uid: string) => ({ expense_id: expense.id, user_id: uid, weight: 1.0 }))
  );

  await saveSession(phone, { step: 'menu', context: {} });
  const label = description ? `*${description}* · ` : '';
  await waSend(phone, `✅ ¡Gasto registrado!\n${label}${fmt(amount, currency)}`);
  await showMenu(phone, { ...session, step: 'menu', context: {} });
}

// ── Info views ─────────────────────────────────────────────────────────────

async function sendBalances(phone: string, session: WaSession): Promise<void> {
  const { data: trip } = await supabase.from('trips').select('currency').eq('id', session.trip_id!).single();
  const currency = trip?.currency ?? 'COP';

  const { data: expenses } = await supabase
    .from('expenses')
    .select('*, participants:expense_participants(*)')
    .eq('trip_id', session.trip_id!)
    .eq('status', 'confirmed');

  if (!expenses?.length) {
    await waSend(phone, 'Aún no hay gastos registrados en este viaje.');
    await showMenu(phone, session);
    return;
  }

  const balances  = computeBalances(expenses as Expense[]);
  const transfers = optimizeTransfers(balances);

  const lines: string[] = ['*Balances*', ''];
  for (const b of balances) {
    const sign = b.net > 0 ? '+' : '';
    lines.push(`${b.name}: ${sign}${fmt(b.net, currency)}`);
  }

  if (transfers.length) {
    lines.push('', '💸 *Quién le debe a quién:*');
    for (const t of transfers) {
      lines.push(`${t.from_name} → ${t.to_name}: ${fmt(t.amount, currency)}`);
    }
  }

  await waSend(phone, lines.join('\n'));
  await showMenu(phone, session);
}

async function sendResumen(phone: string, session: WaSession): Promise<void> {
  const [tripRes, expRes, membersRes, settlementsRes] = await Promise.all([
    supabase.from('trips').select('name, currency').eq('id', session.trip_id!).single(),
    supabase.from('expenses').select('*, participants:expense_participants(*)').eq('trip_id', session.trip_id!).eq('status', 'confirmed'),
    supabase.from('trip_users').select('id, name, payment_ref').eq('trip_id', session.trip_id!).eq('status', 'active'),
    supabase.from('settlements').select('*, from:from_user(id,name), to:to_user(id,name,payment_ref)').eq('trip_id', session.trip_id!).order('created_at', { ascending: false })
  ]);

  const trip        = tripRes.data;
  const expenses    = expRes.data ?? [];
  const members     = membersRes.data ?? [];
  const settlements = settlementsRes.data ?? [];
  const currency    = trip?.currency ?? 'COP';

  const totalSpent  = expenses.reduce((s: number, e: Record<string, number>) => s + (e.amount_base ?? e.amount_total), 0);
  const balances    = computeBalances(expenses as Expense[]);
  const transfers   = optimizeTransfers(balances);
  const memberMap   = Object.fromEntries(members.map((m) => [m.id, m]));
  const pending     = settlements.filter((s) => s.status === 'pending');
  const paid        = settlements.filter((s) => s.status === 'paid');

  const lines: string[] = [
    `*${trip?.name}*`,
    `Total gastado: ${fmt(totalSpent, currency)}`
  ];

  if (pending.length > 0) {
    lines.push('', '💸 *Por pagar:*');
    for (const s of pending) {
      const to = s.to as Member;
      let line = `• ${(s.from as Member)?.name} → ${to?.name}: ${fmt(s.amount, currency)}`;
      if (to?.payment_ref) line += `\n  ${to.payment_ref}`;
      lines.push(line);
    }
  } else if (transfers.length > 0) {
    lines.push('', '💸 *Cómo quedaría el cierre:*');
    for (const t of transfers) {
      const toMember = memberMap[t.to_user] as Member | undefined;
      let line = `• ${t.from_name} → ${t.to_name}: ${fmt(t.amount, currency)}`;
      if (toMember?.payment_ref) line += `\n  ${toMember.payment_ref}`;
      lines.push(line);
    }
  }

  if (paid.length > 0) {
    const paidTotal = paid.reduce((s: number, p) => s + p.amount, 0);
    lines.push('', `✅ Ya liquidado: ${fmt(paidTotal, currency)}`);
  }

  await waSend(phone, lines.join('\n'));
  await showMenu(phone, session);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTripMembers(tripId: string): Promise<Member[]> {
  const { data } = await supabase
    .from('trip_users')
    .select('id, name, payment_ref')
    .eq('trip_id', tripId)
    .eq('status', 'active')
    .order('joined_at');
  return (data as Member[]) ?? [];
}

async function sendMemberSelection(
  phone: string,
  members: Member[],
  body: string,
  idPrefix: string,
  listButtonText: string
): Promise<void> {
  const buttons = members.map((m) => ({ id: `${idPrefix}${m.id}`, title: m.name }));
  if (members.length <= 3) {
    await waButtons(phone, body, buttons);
  } else {
    await waList(phone, body, listButtonText, [{ rows: buttons }]);
  }
}

function findMember(
  members: Member[],
  input: string,
  idPrefix: string
): Member | undefined {
  if (!input) return undefined;

  // Match by prefixed id (from interactive button)
  if (idPrefix && input.startsWith(idPrefix)) {
    const id = input.slice(idPrefix.length);
    return members.find((m) => m.id === id);
  }

  // Match by plain id
  const byId = members.find((m) => m.id === input);
  if (byId) return byId;

  // Match by 1-based index
  const idx = parseInt(input) - 1;
  if (idx >= 0 && idx < members.length) return members[idx];

  // Match by name substring
  const lower = input.toLowerCase();
  return members.find((m) => m.name.toLowerCase().includes(lower));
}

function parseAmountInput(text: string): { amount: number; description: string } {
  const cleaned = text.trim().replace(/[$€£]/g, '');

  // Find the largest number in the string (es-CO: 1.200.000 or 1200000)
  const matches = [...cleaned.matchAll(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+/g)];

  if (!matches.length) return { amount: 0, description: '' };

  let amount    = 0;
  let amountRaw = '';

  for (const m of matches) {
    // Normalize: strip thousands dots, convert decimal comma to dot
    const normalized = m[0].replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    if (num > amount) { amount = num; amountRaw = m[0]; }
  }

  const description = cleaned
    .replace(amountRaw, '')
    .replace(/[·\-,|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { amount, description };
}

function detectCategory(description: string): string {
  const d = description.toLowerCase();
  if (/comida|cena|almuerzo|desayuno|restaurante|café|cafe|mercado|snack|pizza|sushi/.test(d)) return 'comida';
  if (/taxi|uber|didi|bus|metro|tren|avión|vuelo|transporte|gasolina|moto/.test(d)) return 'transporte';
  if (/hotel|hostal|airbnb|alojamiento|habitación|hospedaje/.test(d)) return 'alojamiento';
  if (/entrada|museo|concierto|bar|fiesta|discoteca|club|show|evento/.test(d)) return 'entretenimiento';
  if (/tienda|mall|compra|ropa|zapatos|shopping/.test(d)) return 'compras';
  return 'general';
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency, maximumFractionDigits: 0
  }).format(amount);
}
