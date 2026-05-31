<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { fade, fly, slide } from 'svelte/transition';
  import type { PageData } from './$types';
  import type { TripUser } from '$lib/types';
  import { CURRENCIES, fetchExchangeRate, groupCurrencies, currencyFlag } from '$lib/currencies';

  let { data }: { data: PageData } = $props();

  let currentUserId = $state<string | null>(null);
  let activeTab = $state<'gastos' | 'balances' | 'liquidar' | 'miembros'>('gastos');
  let showExpenseForm = $state(false);

  // Expense form
  let expDescription = $state('');
  let expAmountInput = $state('');
  let expCurrency = $state('');         // set in onMount to trip currency
  let expExchangeRate = $state(1);
  let fetchingRate = $state(false);
  let rateError = $state('');
  let expCategory = $state('general');
  let expSettlementType = $state<'immediate' | 'deferred'>('deferred');
  let expPaidBy = $state('');
  let expParticipants = $state<string[]>([]);
  let submitting = $state(false);

  // Split mode
  type SplitMode = 'equal' | 'weighted' | 'itemized';
  type ExpItem = { _id: string; description: string; quantity: number; amountInput: string; assignees: string[] };
  let splitMode = $state<SplitMode>('equal');
  let memberWeights = $state<Record<string, number>>({});
  let expItems = $state<ExpItem[]>([]);
  let editingExpenseId = $state<string | null>(null);

  // Tip
  let showTip = $state(false);
  let tipInput = $state('');
  let tipMode = $state<'proportional' | 'flat'>('proportional');
  let tipIncluded = $state(false);

  // UI feedback
  let copiedToken = $state(false);
  let copiedRef = $state<string | null>(null);
  let copiedResumen = $state(false);
  let actionError = $state('');

  const categories = ['general', 'comida', 'transporte', 'alojamiento', 'entretenimiento', 'compras', 'otro'];

  const categoryEmojis: Record<string, string> = {
    general: '🧾', comida: '🍽️', transporte: '🚗', alojamiento: '🏨',
    entretenimiento: '🎉', compras: '🛍️', otro: '📦'
  };
  const categoryLabels: Record<string, string> = {
    general: 'General', comida: 'Comida', transporte: 'Transporte', alojamiento: 'Alojamiento',
    entretenimiento: 'Entretenimiento', compras: 'Compras', otro: 'Otro'
  };
  const categoryChipColors: Record<string, string> = {
    general:         'bg-stone-700/50 text-stone-400',
    comida:          'bg-orange-950/70 text-orange-400 border border-orange-900/40',
    transporte:      'bg-sky-950/70 text-sky-400 border border-sky-900/40',
    alojamiento:     'bg-violet-950/70 text-violet-400 border border-violet-900/40',
    entretenimiento: 'bg-pink-950/70 text-pink-400 border border-pink-900/40',
    compras:         'bg-teal-950/70 text-teal-400 border border-teal-900/40',
    otro:            'bg-stone-700/50 text-stone-500'
  };
  const avatarColors = [
    'bg-brand-500/20 text-brand-400',
    'bg-sky-500/20 text-sky-400',
    'bg-violet-500/20 text-violet-400',
    'bg-emerald-500/20 text-emerald-400',
    'bg-pink-500/20 text-pink-400',
    'bg-amber-500/20 text-amber-400',
    'bg-teal-500/20 text-teal-400',
    'bg-rose-500/20 text-rose-400',
  ];

  function splitMemberName(name: string): { avatar: string | null; displayName: string } {
    const spaceIdx = name.indexOf(' ');
    if (spaceIdx > 0) {
      const first = name.slice(0, spaceIdx);
      // emoji: first codepoint above Latin range, and string short enough to be a single glyph
      if ((first.codePointAt(0) ?? 0) > 0xFF && first.length <= 8) {
        return { avatar: first, displayName: name.slice(spaceIdx + 1) };
      }
    }
    return { avatar: null, displayName: name };
  }

  function onAmountFocus(e: FocusEvent) {
    const input = e.target as HTMLInputElement;
    expAmountInput = input.value.replace(/\./g, '').replace(/,/g, '.');
  }
  function onAmountBlur(e: FocusEvent) {
    const input = e.target as HTMLInputElement;
    const num = parseFloat(input.value.replace(/\./g, '').replace(',', '.'));
    expAmountInput = (!isNaN(num) && num > 0) ? new Intl.NumberFormat('es-CO').format(num) : '';
  }
  function getRawAmount(): number {
    return parseFloat(expAmountInput.replace(/\./g, '').replace(',', '.')) || 0;
  }

  onMount(() => {
    currentUserId = localStorage.getItem(`trip_${data.trip.id}_user`);
    expPaidBy = currentUserId ?? data.members[0]?.id ?? '';
    expParticipants = data.members.map((m) => m.id);
    expCurrency = data.trip.currency;
    const memberStatus = data.members.find((m) => m.id === currentUserId)?.status ?? 'active';
    localStorage.setItem('pal_last_trip', JSON.stringify({ id: data.trip.id, name: data.trip.name, status: memberStatus }));
  });

  async function onExpCurrencyChange(newCurrency: string) {
    expCurrency = newCurrency;
    if (newCurrency === data.trip.currency) { expExchangeRate = 1; rateError = ''; return; }
    fetchingRate = true; rateError = '';
    try {
      expExchangeRate = Math.round(await fetchExchangeRate(newCurrency, data.trip.currency) * 1e4) / 1e4;
    } catch {
      rateError = 'No se pudo obtener la tasa. Ingrésala manualmente.';
      expExchangeRate = 0;
    } finally { fetchingRate = false; }
  }

  function authHeaders(extra: Record<string, string> = {}) {
    return { 'Content-Type': 'application/json', 'X-Member-Id': currentUserId ?? '', ...extra };
  }

  const currentMember = $derived(
    [...data.members, ...data.pendingMembers].find((m) => m.id === currentUserId) as TripUser | undefined
  );
  const isAdmin = $derived(currentMember?.role === 'admin');
  const isPending = $derived(currentMember?.status === 'pending');
  const pendingSettlements = $derived(data.settlements.filter((s) => s.status === 'pending'));
  const paidSettlements = $derived(data.settlements.filter((s) => s.status === 'paid'));
  const totalSpent = $derived(data.expenses.reduce((sum, e) => sum + (e.amount_base ?? e.amount_total), 0));
  const expAmountBase = $derived(
    expCurrency === data.trip.currency
      ? getRawAmount()
      : getRawAmount() * expExchangeRate
  );
  const isForeignCurrency = $derived(expCurrency !== '' && expCurrency !== data.trip.currency);

  function rawItemAmt(amountInput: string) {
    return parseFloat(amountInput.replace(/\./g, '').replace(',', '.')) || 0;
  }
  const itemsSubtotal = $derived(expItems.reduce((s, i) => s + i.quantity * rawItemAmt(i.amountInput), 0));
  const hasAmount = $derived(splitMode === 'itemized' ? itemsSubtotal > 0 : !!expAmountInput.trim());
  const tipRaw = $derived(parseFloat(tipInput.replace(/\./g, '').replace(',', '.')) || 0);
  const grandTotal = $derived.by(() => {
    const base = splitMode === 'itemized' ? itemsSubtotal : getRawAmount();
    return base + (showTip && !tipIncluded ? tipRaw : 0);
  });
  const submitDisabled = $derived(
    splitMode === 'equal'
      ? (!expAmountInput || !expPaidBy || expParticipants.length === 0)
      : splitMode === 'weighted'
        ? (!expAmountInput || !expPaidBy)
        : (expItems.length === 0 || itemsSubtotal === 0 || !expPaidBy || expItems.some((i) => i.assignees.length === 0))
  );

  function fmt(amount: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: data.trip.currency, maximumFractionDigits: 0
    }).format(amount);
  }

  async function submitExpense() {
    if (!expPaidBy || submitDisabled) return;
    submitting = true; actionError = '';
    try {
      let amount = 0;
      let participants: { user_id: string; weight?: number }[] = [];

      const tipAddition = showTip && !tipIncluded ? tipRaw : 0;
      if (splitMode === 'equal') {
        amount = getRawAmount() + tipAddition;
        participants = expParticipants.map((id) => ({ user_id: id }));
      } else if (splitMode === 'weighted') {
        amount = getRawAmount() + tipAddition;
        participants = data.members
          .filter((m) => (memberWeights[m.id] ?? 1) > 0)
          .map((m) => ({ user_id: m.id, weight: memberWeights[m.id] ?? 1 }));
      } else {
        // itemized: compute per-member totals as weights so the existing engine works
        amount = grandTotal;
        const totals: Record<string, number> = {};
        for (const item of expItems) {
          const amt = item.quantity * rawItemAmt(item.amountInput);
          if (!amt || !item.assignees.length) continue;
          const share = amt / item.assignees.length;
          for (const uid of item.assignees) totals[uid] = (totals[uid] ?? 0) + share;
        }
        if (showTip && tipRaw > 0) {
          const uids = Object.keys(totals);
          for (const uid of uids) {
            totals[uid] += tipMode === 'flat'
              ? tipRaw / uids.length
              : tipRaw * (totals[uid] / itemsSubtotal);
          }
        }
        participants = Object.entries(totals).filter(([, t]) => t > 0).map(([uid, t]) => ({ user_id: uid, weight: t }));
      }

      const url = editingExpenseId ? `/api/expenses/${editingExpenseId}` : '/api/expenses';
      const method = editingExpenseId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method, headers: authHeaders(),
        body: JSON.stringify({
          trip_id: data.trip.id, description: expDescription.trim(),
          amount_total: amount, currency: expCurrency,
          exchange_rate: expExchangeRate,
          paid_by: expPaidBy, settlement_type: expSettlementType,
          category: expCategory, participants,
          split_mode: splitMode,
          tip_amount: showTip ? tipRaw : 0,
          tip_mode: tipMode,
          ...(splitMode === 'itemized' && {
            items: expItems.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: rawItemAmt(i.amountInput), amount: i.quantity * rawItemAmt(i.amountInput), assignees: i.assignees }))
          })
        })
      });
      if (!res.ok) throw new Error((await res.json()).message);
      closeForm();
      await invalidateAll();
    } catch (e: unknown) {
      actionError = e instanceof Error ? e.message : 'Error al guardar';
    } finally { submitting = false; }
  }

  function closeForm() {
    showExpenseForm = false;
    expDescription = ''; expAmountInput = ''; expCategory = 'general';
    expSettlementType = 'deferred'; expPaidBy = currentUserId ?? '';
    expParticipants = data.members.map((m) => m.id);
    splitMode = 'equal'; memberWeights = {}; expItems = [];
    showTip = false; tipInput = ''; tipMode = 'proportional'; tipIncluded = false;
    expCurrency = data.trip.currency; expExchangeRate = 1;
    fetchingRate = false; rateError = '';
    editingExpenseId = null;
    actionError = '';
  }

  async function deleteExpense(id: string) {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) { actionError = (await res.json()).message ?? 'Error al eliminar'; return; }
    await invalidateAll();
  }

  async function generateSettlements() {
    const res = await fetch(`/api/trips/${data.trip.id}/settle`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ granularity: data.trip.currency === 'COP' ? 1000 : 1 })
    });
    if (!res.ok) { actionError = (await res.json()).message ?? 'Error'; return; }
    await invalidateAll();
    activeTab = 'liquidar';
  }

  async function markPaid(settlementId: string) {
    await fetch(`/api/settlements/${settlementId}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ status: 'paid' })
    });
    await invalidateAll();
  }

  async function approveMember(memberId: string) {
    const res = await fetch(`/api/trips/${data.trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: 'active' })
    });
    if (!res.ok) { actionError = (await res.json()).message ?? 'Error'; return; }
    await invalidateAll();
  }

  async function rejectMember(memberId: string) {
    await fetch(`/api/trips/${data.trip.id}/members/${memberId}`, {
      method: 'DELETE', headers: authHeaders()
    });
    await invalidateAll();
  }

  async function changeRole(memberId: string, role: 'admin' | 'member') {
    const res = await fetch(`/api/trips/${data.trip.id}/members/${memberId}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ role })
    });
    if (!res.ok) { actionError = (await res.json()).message ?? 'Error'; return; }
    await invalidateAll();
  }

  async function removeMember(memberId: string) {
    await fetch(`/api/trips/${data.trip.id}/members/${memberId}`, {
      method: 'DELETE', headers: authHeaders()
    });
    await invalidateAll();
  }

  async function leaveTrip() {
    if (!currentUserId) return;
    await fetch(`/api/trips/${data.trip.id}/members/${currentUserId}`, {
      method: 'DELETE', headers: authHeaders()
    });
    localStorage.removeItem(`trip_${data.trip.id}_user`);
    goto('/');
  }

  function copyToken() {
    const link = `${window.location.origin}/?join=${data.trip.access_token}`;
    const msg = `¡Hola! Te invito a gestionar nuestras cuentas de ${data.trip.name} usando *Pa'l Trip* GRATIS ✨ Únete aquí: ${link}`;
    navigator.clipboard.writeText(msg);
    copiedToken = true;
    setTimeout(() => (copiedToken = false), 2000);
  }
  function copyRef(ref: string, key: string) {
    navigator.clipboard.writeText(ref);
    copiedRef = key;
    setTimeout(() => (copiedRef = null), 2000);
  }
  function toggleParticipant(id: string) {
    expParticipants = expParticipants.includes(id)
      ? expParticipants.filter((x) => x !== id)
      : [...expParticipants, id];
  }

  function openEditForm(expense: (typeof data.expenses)[number]) {
    editingExpenseId = expense.id;
    expDescription = expense.description;
    expAmountInput = expense.amount_total > 0 ? new Intl.NumberFormat('es-CO').format(expense.amount_total) : '';
    expCurrency = expense.currency;
    expExchangeRate = expense.exchange_rate ?? 1;
    expCategory = expense.category;
    expSettlementType = expense.settlement_type;
    expPaidBy = expense.paid_by;
    splitMode = (expense.split_mode as SplitMode) ?? 'equal';

    if (splitMode === 'weighted') {
      memberWeights = Object.fromEntries((expense.participants ?? []).map((p: { user_id: string; weight: number }) => [p.user_id, p.weight]));
    } else {
      expParticipants = (expense.participants ?? []).map((p: { user_id: string }) => p.user_id);
    }

    if (splitMode === 'itemized' && expense.items?.length) {
      expItems = expense.items.map((item: { description: string; quantity: number; unit_price: number; assignments?: { user_id: string }[] }) => ({
        _id: crypto.randomUUID(),
        description: item.description,
        quantity: item.quantity,
        amountInput: new Intl.NumberFormat('es-CO').format(item.unit_price),
        assignees: item.assignments?.map((a: { user_id: string }) => a.user_id) ?? []
      }));
    }

    if ((expense.tip_amount ?? 0) > 0) {
      showTip = true;
      tipInput = new Intl.NumberFormat('es-CO').format(expense.tip_amount);
      tipMode = (expense.tip_mode as 'proportional' | 'flat') ?? 'proportional';
    }

    showExpenseForm = true;
  }

  function generateResumenText(): string {
    const lines: string[] = [];
    lines.push(`*${data.trip.name}*`);
    lines.push(`Total gastado: ${fmt(totalSpent)}`);
    if (data.transfers.length > 0 || pendingSettlements.length > 0) lines.push('');
    if (pendingSettlements.length > 0) {
      lines.push('💸 Por pagar:');
      for (const s of pendingSettlements) {
        const to = s.to as TripUser;
        let line = `• ${(s.from as TripUser)?.name} → ${to?.name}: ${fmt(s.amount)}`;
        if (to?.payment_ref) line += `\n  ${to.payment_ref}`;
        lines.push(line);
      }
    } else if (data.transfers.length > 0) {
      lines.push('💸 Cómo quedaría el cierre:');
      for (const t of data.transfers) {
        const toMember = data.members.find((m) => m.id === t.to_user);
        let line = `• ${t.from_name} → ${t.to_name}: ${fmt(t.amount)}`;
        if (toMember?.payment_ref) line += `\n  ${toMember.payment_ref}`;
        lines.push(line);
      }
    }
    if (paidSettlements.length > 0) {
      const paidTotal = paidSettlements.reduce((s, p) => s + p.amount, 0);
      lines.push('');
      lines.push(`✅ Ya liquidado: ${fmt(paidTotal)}`);
    }
    return lines.join('\n');
  }

  async function copyResumen() {
    await navigator.clipboard.writeText(generateResumenText());
    copiedResumen = true;
    setTimeout(() => (copiedResumen = false), 2500);
  }

  async function closeTrip() {
    const res = await fetch(`/api/trips/${data.trip.id}/close`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) { actionError = 'No se pudo cerrar el viaje'; return; }
    await invalidateAll();
  }

  async function reopenTrip() {
    await fetch(`/api/trips/${data.trip.id}/close`, { method: 'DELETE', headers: authHeaders() });
    await invalidateAll();
  }

  function setSplitMode(mode: SplitMode) {
    splitMode = mode;
    if (mode === 'weighted' && !Object.keys(memberWeights).length) {
      memberWeights = Object.fromEntries(data.members.map((m) => [m.id, 1]));
    }
  }

  function adjustWeight(memberId: string, delta: number) {
    memberWeights = { ...memberWeights, [memberId]: Math.max(1, (memberWeights[memberId] ?? 1) + delta) };
  }

  function addItem() {
    expItems = [...expItems, { _id: crypto.randomUUID(), description: '', quantity: 1, amountInput: '', assignees: data.members.map((m) => m.id) }];
  }

  function removeItem(id: string) {
    expItems = expItems.filter((i) => i._id !== id);
  }

  function toggleItemAssignee(itemId: string, memberId: string) {
    expItems = expItems.map((i) => i._id !== itemId ? i : {
      ...i, assignees: i.assignees.includes(memberId) ? i.assignees.filter((a) => a !== memberId) : [...i.assignees, memberId]
    });
  }

  function onItemAmountFocus(itemId: string, e: FocusEvent) {
    const v = (e.target as HTMLInputElement).value.replace(/\./g, '').replace(',', '.');
    expItems = expItems.map((i) => i._id !== itemId ? i : { ...i, amountInput: v });
  }

  function onItemAmountBlur(itemId: string, e: FocusEvent) {
    const num = parseFloat((e.target as HTMLInputElement).value.replace(/\./g, '').replace(',', '.'));
    expItems = expItems.map((i) => i._id !== itemId ? i : {
      ...i, amountInput: (!isNaN(num) && num > 0) ? new Intl.NumberFormat('es-CO').format(num) : ''
    });
  }

  function onTipFocus(e: FocusEvent) {
    tipInput = (e.target as HTMLInputElement).value.replace(/\./g, '').replace(',', '.');
  }
  function onTipBlur(e: FocusEvent) {
    const num = parseFloat((e.target as HTMLInputElement).value.replace(/\./g, '').replace(',', '.'));
    tipInput = (!isNaN(num) && num > 0) ? new Intl.NumberFormat('es-CO').format(num) : '';
  }

  function memberItemTotal(memberId: string): number {
    let total = 0;
    for (const item of expItems) {
      const amt = item.quantity * rawItemAmt(item.amountInput);
      if (item.assignees.includes(memberId) && item.assignees.length > 0) total += amt / item.assignees.length;
    }
    if (showTip && tipRaw > 0 && itemsSubtotal > 0) {
      total += tipMode === 'flat'
        ? tipRaw / new Set(expItems.flatMap((i) => i.assignees)).size
        : tipRaw * (total / itemsSubtotal);
    }
    return total;
  }

  function updateItemQty(id: string, delta: number) {
    expItems = expItems.map((i) => i._id !== id ? i : { ...i, quantity: Math.max(1, i.quantity + delta) });
  }
</script>

<!-- ══ ESTADO PENDIENTE ══════════════════════════════════════════════════════ -->
{#if isPending}
  <div class="min-h-screen flex items-center justify-center px-4" in:fade={{ duration: 300 }}>
    <div class="w-full max-w-sm space-y-6">
      <div class="space-y-2">
        <h1 class="font-display font-bold text-2xl text-stone-50">Solicitud enviada</h1>
        <p class="text-stone-400 text-sm leading-relaxed">
          Estás en la lista de espera para
          <span class="text-stone-200 font-medium">{data.trip.name}</span>.
          Un administrador tiene que aprobarte antes de que puedas ver el viaje.
        </p>
      </div>
      <div class="bg-stone-900 border border-stone-800 rounded-2xl p-5 space-y-4">
        <div>
          <p class="text-xs text-stone-500 uppercase tracking-wide font-medium mb-1">Nombre registrado</p>
          <p class="font-medium text-stone-100">{currentMember?.name}</p>
        </div>
        {#if currentMember?.payment_ref}
          <div>
            <p class="text-xs text-stone-500 uppercase tracking-wide font-medium mb-1">Dato bancario</p>
            <p class="text-sm text-stone-300">{currentMember.payment_ref}</p>
          </div>
        {/if}
      </div>
      <button onclick={() => invalidateAll()} class="btn-secondary w-full">
        Revisar estado
      </button>
    </div>
  </div>

<!-- ══ DASHBOARD PRINCIPAL ═══════════════════════════════════════════════════ -->
{:else}
<div class="min-h-screen flex flex-col max-w-lg mx-auto px-4 pb-28">

  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="sticky top-0 z-10 bg-stone-950/95 backdrop-blur pt-5 pb-0 mb-6">
    {#if actionError}
      <div class="bg-red-950 border border-red-800/60 text-red-300 text-xs px-3 py-2.5 rounded-xl mb-4 flex justify-between items-start gap-2"
        in:fly={{ y: -8, duration: 200 }}>
        <span>{actionError}</span>
        <button onclick={() => (actionError = '')} class="text-red-500 hover:text-red-300 shrink-0 leading-none">✕</button>
      </div>
    {/if}

    <div class="flex items-start justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h1 class="font-display font-bold text-xl text-stone-50 truncate">{data.trip.name}</h1>
        <p class="text-xs text-stone-500 mt-0.5">
          {data.members.length} {data.members.length === 1 ? 'persona' : 'personas'} · {fmt(totalSpent)}
          {#if data.trip.status === 'closed'}
            · <span class="text-amber-500 font-semibold">cerrado</span>
          {/if}
          {#if isAdmin && data.pendingMembers.length > 0}
            · <span class="text-amber-400 font-semibold">{data.pendingMembers.length} por aprobar</span>
          {/if}
        </p>
      </div>
      <button
        onclick={copyToken}
        class="shrink-0 flex items-center gap-1.5 text-xs bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-400 hover:text-stone-200 px-3 py-1.5 rounded-lg transition-all duration-150 active:scale-95"
      >
        {#if copiedToken}
          <span class="text-emerald-400 font-medium" in:fade={{ duration: 150 }}>¡Copiado!</span>
        {:else}
          <span>Compartir viaje</span>
        {/if}
      </button>
    </div>

    <!-- Tabs -->
    <nav class="flex border-b border-stone-800 -mx-4 px-4">
      {#each [['gastos','Gastos'], ['balances','Balances'], ['liquidar','Cuentas'], ['miembros','Miembros']] as [tab, label]}
        <button
          onclick={() => (activeTab = tab as typeof activeTab)}
          class="relative flex-1 text-sm font-medium pb-3 border-b-2 transition-colors duration-200 {activeTab === tab
            ? 'border-brand-500 text-stone-50'
            : 'border-transparent text-stone-500 hover:text-stone-300'}"
        >
          {label}
          {#if tab === 'miembros' && isAdmin && data.pendingMembers.length > 0}
            <span class="absolute top-1 right-[calc(50%-14px)] w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
          {/if}
        </button>
      {/each}
    </nav>
  </header>

  <!-- Tab content with fade transition on switch -->
  {#key activeTab}
  <div in:fade={{ duration: 180, delay: 40 }}>

  <!-- ── GASTOS ─────────────────────────────────────────────────────────── -->
  {#if activeTab === 'gastos'}
    {#if data.trip.status === 'closed'}
      <div class="bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3 text-sm text-amber-500/80 text-center mb-3" in:fade={{ duration: 200 }}>
        Viaje cerrado · solo lectura
      </div>
    {/if}
    {#if data.expenses.length === 0}
      <div class="text-center py-20 text-sm" in:fade={{ duration: 300, delay: 100 }}>
        <p class="text-4xl mb-4">🧾</p>
        <p class="text-stone-400 font-medium">Aún no hay gastos.</p>
        <p class="text-stone-600 mt-1">Agrega el primero con el botón de abajo.</p>
      </div>
    {/if}
    <div class="space-y-2.5">
      {#each data.expenses as expense, i}
        <div
          in:fly={{ y: 10, duration: 220, delay: i * 45 }}
          class="bg-stone-900 rounded-2xl border border-stone-800 p-4 space-y-2.5 hover:-translate-y-0.5 hover:border-stone-700 transition-all duration-200 cursor-default"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="font-medium text-stone-100 truncate">
                {expense.description || categoryLabels[expense.category] || expense.category}
              </div>
              <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">
                {#if expense.description}
                  <span class="text-xs px-1.5 py-px rounded font-medium {categoryChipColors[expense.category] ?? 'bg-stone-700/50 text-stone-400'}">
                    {categoryLabels[expense.category]}
                  </span>
                {/if}
                <span class="text-xs text-stone-500">
                  Pagó {(expense.payer as TripUser)?.name ?? '?'}
                  · {new Date(expense.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-bold text-stone-50 text-lg leading-tight">{fmt(expense.amount_base ?? expense.amount_total)}</div>
              {#if expense.currency !== data.trip.currency}
                <div class="text-xs text-stone-600 leading-tight">
                  {new Intl.NumberFormat('es-CO', { style: 'currency', currency: expense.currency, maximumFractionDigits: 2 }).format(expense.amount_total)}
                </div>
              {/if}
              {#if expense.settlement_type === 'immediate'}
                <span class="inline-block text-xs bg-amber-900/40 text-amber-400 border border-amber-800/50 px-2 py-0.5 rounded-full font-medium mt-0.5">
                  ⚡ ahora
                </span>
              {:else}
                <span class="text-xs text-stone-700 mt-0.5 block">al final</span>
              {/if}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            {#each expense.participants ?? [] as p}
              <span class="text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">
                {(p.member as TripUser)?.name ?? '?'}{#if p.weight !== 1.0} ×{p.weight}{/if}
              </span>
            {/each}
            {#if isAdmin || expense.paid_by === currentUserId}
              <div class="ml-auto flex items-center gap-3">
                <button
                  onclick={() => openEditForm(expense)}
                  class="text-xs text-stone-600 hover:text-brand-400 transition-colors"
                >Editar</button>
                <button
                  onclick={() => deleteExpense(expense.id)}
                  class="text-xs text-stone-700 hover:text-red-400 transition-colors"
                >Eliminar</button>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── BALANCES ───────────────────────────────────────────────────────── -->
  {#if activeTab === 'balances'}
    {#if data.balances.length === 0}
      <div class="text-center py-20 text-sm" in:fade={{ duration: 300, delay: 100 }}>
        <p class="text-4xl mb-4">⚖️</p>
        <p class="text-stone-400 font-medium">Aún sin movimientos.</p>
        <p class="text-stone-600 mt-1">Los balances aparecen cuando hay gastos registrados.</p>
      </div>
    {/if}
    <div class="space-y-2.5">
      {#each data.balances as balance, i}
        <div
          in:fly={{ y: 10, duration: 220, delay: i * 50 }}
          class="rounded-2xl p-4 border transition-all duration-200 hover:-translate-y-0.5
            {balance.net > 0
              ? 'bg-emerald-950/30 border-emerald-900/50 hover:border-emerald-800/60'
              : balance.net < 0
              ? 'bg-red-950/30 border-red-900/50 hover:border-red-800/60'
              : 'bg-stone-900 border-stone-800 hover:border-stone-700'}"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium text-stone-100 truncate">{balance.name}</div>
              <div class="text-xs mt-0.5 {balance.net > 0 ? 'text-emerald-500' : balance.net < 0 ? 'text-red-500' : 'text-stone-600'}">
                {balance.net > 0 ? 'Le deben' : balance.net < 0 ? 'Debe al grupo' : 'Al día'}
              </div>
            </div>
            <div class="font-bold text-xl shrink-0 {balance.net > 0 ? 'text-emerald-400' : balance.net < 0 ? 'text-red-400' : 'text-stone-600'}">
              {balance.net > 0 ? '+' : ''}{fmt(balance.net)}
            </div>
          </div>
        </div>
      {/each}

      {#if data.transfers.length > 0}
        <div
          in:fly={{ y: 10, duration: 220, delay: data.balances.length * 50 }}
          class="bg-stone-900 rounded-2xl p-4 border border-stone-800 space-y-3 mt-2"
        >
          <h3 class="text-xs font-semibold text-stone-500 uppercase tracking-wide">Quién le debe a quién</h3>
          {#each data.transfers as t, i}
            <div in:fly={{ y: 6, duration: 180, delay: i * 40 }} class="flex items-center gap-2 text-sm py-0.5">
              <span class="font-medium text-stone-200 min-w-0 truncate">{t.from_name}</span>
              <span class="text-stone-700 shrink-0">→</span>
              <span class="font-medium text-stone-200 min-w-0 truncate">{t.to_name}</span>
              <span class="ml-auto font-bold text-brand-400 shrink-0">{fmt(t.amount)}</span>
            </div>
          {/each}
        </div>
        {#if isAdmin}
          <div in:fly={{ y: 10, duration: 220, delay: (data.balances.length + 1) * 50 }}>
            <button onclick={generateSettlements} class="btn-primary w-full mt-2">
              Cerrar cuentas del viaje
            </button>
          </div>
        {/if}
      {/if}

      {#if data.expenses.length > 0}
        <div in:fly={{ y: 10, duration: 220, delay: (data.balances.length + 2) * 50 }}>
          <button
            onclick={copyResumen}
            class="w-full py-3 rounded-xl border text-sm font-medium transition-all duration-150 mt-2
              {copiedResumen
                ? 'bg-emerald-500/10 border-emerald-600/40 text-emerald-400'
                : 'border-stone-700 bg-stone-800/60 text-stone-400 hover:text-stone-200 hover:border-stone-600'}"
          >{copiedResumen ? 'Copiado al portapapeles' : 'Compartir resumen'}</button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── CUENTAS ────────────────────────────────────────────────────────── -->
  {#if activeTab === 'liquidar'}
    {#if pendingSettlements.length === 0 && paidSettlements.length === 0}
      <div class="text-center py-20 text-sm" in:fade={{ duration: 300, delay: 100 }}>
        <p class="text-4xl mb-4">💸</p>
        <p class="text-stone-400 font-medium">Las cuentas no se han generado aún.</p>
        <p class="text-stone-600 mt-1">
          {isAdmin ? 'Ve a Balances y cierra las cuentas del viaje.' : 'El administrador debe generar las cuentas desde Balances.'}
        </p>
      </div>
    {/if}

    {#if pendingSettlements.length > 0}
      <div class="space-y-3">
        <p class="text-xs font-semibold text-stone-500 uppercase tracking-wide px-1">Pendientes</p>
        {#each pendingSettlements as s, i}
          {@const toMember = s.to as TripUser}
          <div in:fly={{ y: 10, duration: 220, delay: i * 60 }}
            class="bg-stone-900 rounded-2xl p-5 border border-stone-800 space-y-4 hover:border-stone-700 transition-colors">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm text-stone-400 min-w-0 truncate">
                <span class="font-medium text-stone-100">{(s.from as TripUser)?.name}</span>
                <span class="mx-1.5 text-stone-700">→</span>
                <span class="font-medium text-stone-100">{toMember?.name}</span>
              </div>
              <div class="font-bold text-2xl text-brand-400 shrink-0">{fmt(s.amount)}</div>
            </div>
            {#if toMember?.payment_ref}
              <div class="flex items-center gap-3 bg-stone-800 border border-stone-700 rounded-xl px-4 py-3">
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-stone-500 mb-0.5">Transferir a</div>
                  <div class="text-sm text-stone-100 font-medium truncate">{toMember.payment_ref}</div>
                </div>
                <button
                  onclick={() => copyRef(toMember.payment_ref!, s.id)}
                  class="text-xs font-semibold shrink-0 px-3 py-1.5 rounded-lg transition-all active:scale-95 {copiedRef === s.id
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-stone-700 hover:bg-stone-600 text-stone-300'}"
                >{copiedRef === s.id ? '¡Copiado!' : 'Copiar'}</button>
              </div>
            {/if}
            <button onclick={() => markPaid(s.id)} class="btn-primary w-full active:scale-[0.98] transition-transform">
              Ya lo pagué
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if paidSettlements.length > 0}
      <div class="space-y-2 mt-6">
        <p class="text-xs font-semibold text-stone-700 uppercase tracking-wide px-1">Pagados</p>
        {#each paidSettlements as s, i}
          <div in:fly={{ y: 8, duration: 180, delay: i * 40 }}
            class="bg-stone-900/40 rounded-2xl p-4 border border-stone-800/40 flex items-center justify-between opacity-40">
            <span class="text-sm text-stone-400">{(s.from as TripUser)?.name} → {(s.to as TripUser)?.name}</span>
            <span class="font-semibold text-stone-500 text-sm">{fmt(s.amount)}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ── MIEMBROS ───────────────────────────────────────────────────────── -->
  {#if activeTab === 'miembros'}
    <div class="space-y-6">

      {#if isAdmin && data.pendingMembers.length > 0}
        <div class="space-y-2.5">
          <h3 class="text-xs font-semibold text-amber-500 uppercase tracking-wide px-1">
            Por aprobar · {data.pendingMembers.length}
          </h3>
          {#each data.pendingMembers as pm, i}
            <div in:fly={{ y: 10, duration: 220, delay: i * 50 }}
              class="bg-amber-950/20 rounded-2xl p-4 border border-amber-900/50 space-y-3 hover:border-amber-800/60 transition-colors">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-medium text-stone-100">{pm.name}</div>
                  {#if pm.payment_ref}
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-xs text-stone-400 truncate">{pm.payment_ref}</span>
                      <button
                        onclick={() => copyRef(pm.payment_ref!, `pm-${pm.id}`)}
                        class="text-xs shrink-0 text-stone-600 hover:text-stone-300 transition-colors"
                      >{copiedRef === `pm-${pm.id}` ? '✓ Copiado' : 'Copiar'}</button>
                    </div>
                  {:else}
                    <span class="text-xs text-stone-700">Sin dato bancario</span>
                  {/if}
                </div>
                <div class="flex gap-2 shrink-0">
                  <button
                    onclick={() => approveMember(pm.id)}
                    class="text-xs font-semibold bg-brand-500/15 hover:bg-brand-500/30 text-brand-400 border border-brand-800/60 px-3 py-1.5 rounded-lg transition-all active:scale-95"
                  >Aprobar</button>
                  <button
                    onclick={() => rejectMember(pm.id)}
                    class="text-xs text-stone-600 hover:text-red-400 transition-colors px-1.5"
                  >Rechazar</button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="space-y-2.5">
        <h3 class="text-xs font-semibold text-stone-600 uppercase tracking-wide px-1">
          En el viaje · {data.members.length}
        </h3>
        {#each data.members as m, i}
          {@const split = splitMemberName(m.name)}
          <div in:fly={{ y: 8, duration: 200, delay: i * 40 }}
            class="bg-stone-900 rounded-2xl p-4 border border-stone-800 hover:border-stone-700 transition-colors duration-200">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-full flex items-center justify-center shrink-0
                  {split.avatar ? 'bg-stone-800 text-xl' : avatarColors[i % avatarColors.length]}">
                  {#if split.avatar}
                    <span class="leading-none">{split.avatar}</span>
                  {:else}
                    <span class="text-sm font-bold font-display">{m.name.charAt(0).toUpperCase()}</span>
                  {/if}
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-stone-100">{split.displayName}</span>
                    {#if m.role === 'admin'}
                      <span class="text-xs bg-brand-500/15 text-brand-400 border border-brand-800/50 px-1.5 py-0.5 rounded font-medium shrink-0">admin</span>
                    {/if}
                    {#if m.id === currentUserId}
                      <span class="text-xs text-stone-600 shrink-0">tú</span>
                    {/if}
                  </div>
                  {#if m.payment_ref}
                    <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <span class="text-xs text-stone-500 truncate">{m.payment_ref}</span>
                      <button
                        onclick={(e) => { e.stopPropagation(); copyRef(m.payment_ref!, `mem-${m.id}`); }}
                        class="text-xs shrink-0 transition-colors {copiedRef === `mem-${m.id}` ? 'text-emerald-400' : 'text-stone-600 hover:text-stone-300'}"
                      >{copiedRef === `mem-${m.id}` ? '✓' : 'Copiar'}</button>
                    </div>
                  {/if}
                </div>
              </div>
              {#if isAdmin && m.id !== currentUserId}
                <div class="flex gap-1 shrink-0">
                  <button
                    onclick={() => changeRole(m.id, m.role === 'admin' ? 'member' : 'admin')}
                    class="text-xs text-stone-500 hover:text-stone-200 bg-stone-800 hover:bg-stone-700 border border-stone-700 px-2.5 py-1.5 rounded-lg transition-all"
                  >{m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
                  <button
                    onclick={() => removeMember(m.id)}
                    class="text-xs text-stone-700 hover:text-red-400 transition-colors px-2 py-1.5"
                  >✕</button>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if isAdmin}
        <div class="pt-2 border-t border-stone-800 space-y-2">
          {#if data.trip.status === 'closed'}
            <div class="bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3 text-sm text-amber-400/80 text-center">
              Viaje cerrado · sin nuevos gastos
            </div>
            <button onclick={reopenTrip} class="w-full py-2.5 rounded-xl border border-stone-700 text-sm text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-all">
              Reabrir viaje
            </button>
          {:else}
            <button onclick={closeTrip} class="w-full py-2.5 rounded-xl border border-stone-800 text-sm text-stone-600 hover:text-amber-400 hover:border-amber-900/50 transition-all">
              Cerrar viaje
            </button>
            <p class="text-xs text-stone-800 text-center">Cierra el viaje para bloquear nuevos gastos</p>
          {/if}
        </div>
      {/if}

      <div class="pt-2 border-t border-stone-800">
        <button onclick={leaveTrip} class="w-full text-sm text-stone-600 hover:text-red-400 py-3 transition-colors">
          Salir del viaje y eliminar mis datos
        </button>
        <p class="text-xs text-stone-800 text-center mt-1">
          Si tienes gastos registrados, tu nombre quedará como "Usuario eliminado"
        </p>
      </div>
    </div>
  {/if}

  </div>
  {/key}

</div>

<!-- ── FAB ───────────────────────────────────────────────────────────────── -->
{#if activeTab === 'gastos' && !showExpenseForm && data.trip.status !== 'closed'}
  <button
    in:fly={{ y: 20, duration: 250 }}
    onclick={() => (showExpenseForm = true)}
    class="fixed bottom-6 right-5 bg-brand-500 hover:bg-brand-600 active:scale-95 hover:scale-105 text-white font-semibold text-sm rounded-2xl px-5 py-3.5 flex items-center gap-2 shadow-lg shadow-orange-950/60 hover:shadow-xl hover:shadow-orange-900/50 transition-all duration-200 z-20"
  >
    <span class="text-base font-bold leading-none">+</span>
    Agregar gasto
  </button>
{/if}

<!-- ── Expense sheet ──────────────────────────────────────────────────────── -->
{#if showExpenseForm}
  <div
    class="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end"
    role="button"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) closeForm(); }}
    onkeydown={(e) => { if (e.key === 'Escape') closeForm(); }}
    in:fade={{ duration: 200 }}
  >
    <div
      class="w-full max-w-lg mx-auto bg-stone-900 rounded-t-3xl border-t border-stone-800 flex flex-col max-h-[92vh]"
      in:fly={{ y: 60, duration: 300 }}
    >
      <!-- Fixed header -->
      <div class="px-6 pt-4 pb-4 border-b border-stone-800/60 shrink-0">
        <div class="w-10 h-1 bg-stone-700 rounded-full mx-auto mb-4"></div>
        <div class="flex items-center justify-between">
          <h2 class="font-display font-semibold text-stone-50 text-lg">{editingExpenseId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
          <button onclick={closeForm} class="text-stone-600 hover:text-stone-300 transition-colors text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-stone-800">✕</button>
        </div>
      </div>

      <!-- Scrollable body -->
      <div class="overflow-y-auto flex-1 px-6 py-5 space-y-5">

        <!-- ── Paso 1: descripción + modo + monto/ítems ────────────────────── -->

        <input bind:value={expDescription} placeholder="Descripción (opcional)" class="input" />

        <!-- Split mode -->
        <div class="flex gap-2">
          {#each ([
            { val: 'equal',    label: 'Igual',    hint: 'Todos pagan lo mismo' },
            { val: 'weighted', label: 'Porciones', hint: 'Alguien consume más' },
            { val: 'itemized', label: 'Detallado', hint: 'Ítem por ítem' }
          ] as const) as mode}
            <button
              onclick={() => setSplitMode(mode.val)}
              class="flex-1 text-left px-3 py-2.5 rounded-xl border transition-all duration-150
                {splitMode === mode.val
                  ? 'bg-brand-500/10 border-brand-600/50'
                  : 'border-stone-700 bg-stone-800 hover:border-stone-600'}"
            >
              <div class="text-xs font-semibold {splitMode === mode.val ? 'text-brand-300' : 'text-stone-400'}">{mode.label}</div>
              <div class="text-xs mt-0.5 leading-tight {splitMode === mode.val ? 'text-brand-800' : 'text-stone-600'}">{mode.hint}</div>
            </button>
          {/each}
        </div>

        <!-- Amount: igual + porciones -->
        {#if splitMode !== 'itemized'}
          <div class="flex gap-2">
            <div class="flex-1 min-w-0">
              <input
                bind:value={expAmountInput}
                onfocus={onAmountFocus}
                onblur={onAmountBlur}
                placeholder="Monto total"
                type="text"
                inputmode="decimal"
                class="input"
              />
            </div>
            <select
              value={expCurrency}
              onchange={(e) => onExpCurrencyChange((e.target as HTMLSelectElement).value)}
              class="input !w-28 shrink-0 text-sm"
            >
              {#each groupCurrencies(data.trip.currency) as grp}
                <optgroup label={grp.label}>
                  {#each grp.currencies as c}
                    <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          {#if isForeignCurrency}
            <div class="space-y-1.5" transition:slide={{ duration: 140 }}>
              <div class="flex items-center gap-2">
                <div class="flex-1 space-y-1">
                  <p class="text-xs text-stone-500 font-medium">
                    Tasa: 1 {expCurrency} =
                    {#if fetchingRate}
                      <span class="text-stone-600">obteniendo…</span>
                    {:else}
                      <span class="text-stone-300">{expExchangeRate > 0 ? expExchangeRate.toLocaleString('es-CO', { maximumFractionDigits: 4 }) : '—'}</span>
                      <span class="text-stone-600">{data.trip.currency}</span>
                    {/if}
                  </p>
                  <input
                    value={expExchangeRate > 0 ? parseFloat(expExchangeRate.toFixed(4)) : ''}
                    oninput={(e) => { expExchangeRate = parseFloat((e.target as HTMLInputElement).value.replace(',', '.')) || 0; }}
                    placeholder="Tasa de cambio"
                    type="text"
                    inputmode="decimal"
                    class="input py-2 text-sm"
                  />
                </div>
              </div>
              {#if rateError}
                <p class="text-xs text-amber-500">{rateError}</p>
              {/if}
              {#if expAmountBase > 0}
                <p class="text-xs text-stone-500 px-1">
                  ≈ <span class="text-stone-300 font-medium">{fmt(expAmountBase)}</span>
                  en {data.trip.currency}
                </p>
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Items: detallado -->
        {#if splitMode === 'itemized'}
          <div class="space-y-2">
            {#if expItems.length === 0}
              <div class="flex flex-col items-center py-7 rounded-xl border border-dashed border-stone-700 text-stone-600">
                <span class="text-2xl mb-1.5">🧾</span>
                <span class="text-sm">Agrega los ítems del recibo</span>
              </div>
            {:else}
              <div class="space-y-2">
                {#each expItems as item (item._id)}
                  <div class="bg-stone-800 rounded-xl p-3 space-y-2.5" in:fly={{ y: 6, duration: 180 }}>
                    <!-- Name + delete -->
                    <div class="flex items-center gap-2">
                      <div class="flex-1 min-w-0">
                        <input
                          value={item.description}
                          oninput={(e) => { expItems = expItems.map((i) => i._id !== item._id ? i : { ...i, description: (e.target as HTMLInputElement).value }) }}
                          placeholder="Nombre del ítem"
                          class="input py-2 text-sm"
                        />
                      </div>
                      <button
                        onclick={() => removeItem(item._id)}
                        class="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-stone-600 hover:text-red-400 hover:bg-red-950/30 transition"
                      >✕</button>
                    </div>
                    <!-- Quantity + unit price -->
                    <div class="flex items-center gap-2">
                      <div class="flex items-center gap-0.5 bg-stone-700/60 rounded-xl px-1 shrink-0">
                        <button onclick={() => updateItemQty(item._id, -1)} class="w-7 h-8 flex items-center justify-center text-stone-400 hover:text-stone-100 transition text-base">−</button>
                        <span class="text-sm font-semibold text-stone-100 min-w-[1.25rem] text-center">{item.quantity}</span>
                        <button onclick={() => updateItemQty(item._id, 1)} class="w-7 h-8 flex items-center justify-center text-stone-400 hover:text-stone-100 transition text-base">+</button>
                      </div>
                      <div class="flex-1 min-w-0">
                        <input
                          value={item.amountInput}
                          onfocus={(e) => onItemAmountFocus(item._id, e)}
                          onblur={(e) => onItemAmountBlur(item._id, e)}
                          placeholder="Precio unitario"
                          type="text"
                          inputmode="decimal"
                          class="input py-2 text-sm"
                        />
                      </div>
                      {#if item.quantity > 1 && rawItemAmt(item.amountInput) > 0}
                        <span class="text-xs text-stone-500 shrink-0">{fmt(item.quantity * rawItemAmt(item.amountInput))}</span>
                      {/if}
                    </div>
                    <!-- Assignees -->
                    <div class="flex flex-wrap gap-1.5">
                      {#each data.members as m}
                        <button
                          onclick={() => toggleItemAssignee(item._id, m.id)}
                          class="text-xs px-2.5 py-1 rounded-full border font-medium transition
                            {item.assignees.includes(m.id)
                              ? 'bg-brand-500/15 border-brand-600/60 text-brand-300'
                              : 'border-stone-600 bg-stone-700 text-stone-500 hover:text-stone-300'}"
                        >{m.name}</button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            <button
              onclick={addItem}
              class="w-full py-2.5 rounded-xl border border-dashed border-stone-700 hover:border-brand-600/50 text-sm text-stone-500 hover:text-brand-400 transition-all duration-150"
            >+ Agregar ítem</button>
          </div>
        {/if}

        <!-- ── Paso 2: quién pagó + categoría (aparece cuando hay monto) ───── -->
        {#if hasAmount}
          <div class="grid grid-cols-2 gap-3" transition:slide={{ duration: 160 }}>
            <div class="space-y-1.5">
              <label for="exp-paid-by" class="text-xs text-stone-500 font-medium">¿Quién pagó?</label>
              <select id="exp-paid-by" bind:value={expPaidBy} class="input">
                {#each data.members as m}
                  <option value={m.id}>{m.name}</option>
                {/each}
              </select>
            </div>
            <div class="space-y-1.5">
              <label for="exp-category" class="text-xs text-stone-500 font-medium">Categoría</label>
              <select id="exp-category" bind:value={expCategory} class="input">
                {#each categories as cat}
                  <option value={cat}>{categoryEmojis[cat]} {categoryLabels[cat]}</option>
                {/each}
              </select>
            </div>
          </div>
        {/if}

        <!-- ── Paso 3: participantes + timing (aparece cuando pagador está) ── -->
        {#if hasAmount && expPaidBy}
          <div class="space-y-5" transition:slide={{ duration: 160 }}>

            <!-- Participantes: igual -->
            {#if splitMode === 'equal'}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <p class="text-xs text-stone-500 font-medium">¿Quiénes participan?</p>
                  <div class="flex gap-3 text-xs">
                    <button onclick={() => (expParticipants = data.members.map((m) => m.id))} class="text-brand-500 hover:text-brand-300 font-medium transition-colors">Todos</button>
                    <button onclick={() => (expParticipants = [])} class="text-stone-600 hover:text-stone-400 transition-colors">Ninguno</button>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  {#each data.members as m}
                    <button
                      onclick={() => toggleParticipant(m.id)}
                      class="text-sm px-3 py-1.5 rounded-full border transition-all duration-150 font-medium
                        {expParticipants.includes(m.id)
                          ? 'bg-brand-500/15 border-brand-600/60 text-brand-300'
                          : 'border-stone-700 bg-stone-800 text-stone-500 hover:text-stone-300'}"
                    >{m.name}</button>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Porciones: pesos -->
            {#if splitMode === 'weighted'}
              <div class="space-y-2">
                <p class="text-xs text-stone-500 font-medium">¿Cuántas porciones consumió cada uno?</p>
                {#each data.members as m}
                  {@const wSum = Object.values(memberWeights).reduce((a, b) => a + b, 0)}
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between px-0.5">
                      <span class="text-sm font-medium text-stone-200">{m.name}</span>
                      {#if getRawAmount() > 0}
                        <span class="text-sm font-semibold text-stone-300">{fmt(getRawAmount() * (memberWeights[m.id] ?? 1) / wSum)}</span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2.5">
                      <input
                        type="range" min="1" max="3" step="0.25"
                        value={Math.min(memberWeights[m.id] ?? 1, 3)}
                        oninput={(e) => { memberWeights = { ...memberWeights, [m.id]: parseFloat((e.target as HTMLInputElement).value) }; }}
                        class="flex-1 h-1.5 cursor-pointer"
                        style="accent-color: #18b087"
                      />
                      <div class="flex items-center gap-1 shrink-0">
                        <input
                          type="number" min="1" step="0.25"
                          value={memberWeights[m.id] ?? 1}
                          oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); memberWeights = { ...memberWeights, [m.id]: Math.max(1, v || 1) }; }}
                          class="input w-16 py-1 text-sm text-center tabular-nums"
                        />
                        <span class="text-stone-500 text-xs">×</span>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Detallado: breakdown preview -->
            {#if splitMode === 'itemized' && itemsSubtotal > 0}
              <div class="rounded-xl bg-stone-800/50 px-3 py-2 space-y-1">
                {#each data.members as m}
                  {@const t = memberItemTotal(m.id)}
                  {#if t > 0}
                    <div class="flex justify-between text-xs">
                      <span class="text-stone-500">{m.name}</span>
                      <span class="text-stone-300 font-medium">{fmt(t)}</span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}

            <!-- Propina -->
            <div>
              <button
                onclick={() => { showTip = !showTip; if (!showTip) tipInput = ''; }}
                class="text-xs font-medium transition-colors {showTip ? 'text-stone-400 hover:text-stone-300' : 'text-stone-600 hover:text-brand-400'}"
              >{showTip ? '− Quitar propina' : '+ Agregar propina'}</button>
              {#if showTip}
                <div class="mt-3 space-y-2" transition:slide={{ duration: 140 }}>
                  <div class="flex gap-2">
                    {#each ([
                      { val: 'proportional', label: 'Proporcional', hint: 'Según lo que consumió cada uno' },
                      { val: 'flat',         label: 'Por cabeza',    hint: 'Se divide entre todos por igual' }
                    ] as const) as tm}
                      <button
                        onclick={() => (tipMode = tm.val)}
                        class="flex-1 text-left px-3 py-2 rounded-xl border text-xs transition
                          {tipMode === tm.val
                            ? 'bg-brand-500/10 border-brand-600/50 text-brand-300'
                            : 'border-stone-700 bg-stone-800 text-stone-500 hover:border-stone-600'}"
                      >
                        <div class="font-medium">{tm.label}</div>
                        <div class="mt-0.5 {tipMode === tm.val ? 'text-brand-800' : 'text-stone-700'}">{tm.hint}</div>
                      </button>
                    {/each}
                  </div>
                  <button
                    onclick={() => { tipIncluded = !tipIncluded; tipInput = ''; }}
                    class="text-xs px-3 py-1 rounded-full border transition self-start
                      {tipIncluded
                        ? 'bg-brand-500/10 border-brand-600/50 text-brand-300'
                        : 'border-stone-700 bg-stone-800 text-stone-500 hover:text-stone-300'}"
                  >{tipIncluded ? 'Incluida en total' : 'Adicional al total'}</button>
                  <input bind:value={tipInput} onfocus={onTipFocus} onblur={onTipBlur} placeholder="Monto de propina" type="text" inputmode="numeric" class="input" />
                  {#if tipIncluded && tipRaw > 0}
                    <p class="text-xs text-stone-500 px-1">
                      De los cuales <span class="text-stone-300 font-medium">{new Intl.NumberFormat('es-CO', { style: 'currency', currency: expCurrency || data.trip.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(tipRaw)}</span> son propina
                    </p>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Timing -->
            <div class="space-y-1.5">
              <p class="text-xs text-stone-500 font-medium">¿Cuándo se devuelve?</p>
              <div class="flex gap-2">
                {#each ([
                  { val: 'deferred',  label: 'Al final', hint: 'Se liquida al cerrar el viaje',       color: 'emerald' },
                  { val: 'immediate', label: 'Ahora',     hint: 'El pagador necesita reembolso pronto', color: 'amber'   }
                ] as const) as opt}
                  <button
                    onclick={() => (expSettlementType = opt.val)}
                    class="flex-1 text-left px-3 py-2.5 rounded-xl border transition-all duration-150
                      {expSettlementType === opt.val
                        ? opt.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-600/50' : 'bg-amber-500/10 border-amber-600/50'
                        : 'border-stone-700 bg-stone-800 hover:border-stone-600'}"
                  >
                    <div class="text-sm font-medium {expSettlementType === opt.val
                      ? opt.color === 'emerald' ? 'text-emerald-300' : 'text-amber-300'
                      : 'text-stone-400'}">{opt.label}</div>
                    <div class="text-xs mt-0.5 {expSettlementType === opt.val
                      ? opt.color === 'emerald' ? 'text-emerald-700' : 'text-amber-700'
                      : 'text-stone-600'}">{opt.hint}</div>
                  </button>
                {/each}
              </div>
            </div>

          </div>
        {/if}

        <!-- Total -->
        {#if grandTotal > 0}
          <div class="flex justify-between items-center py-2 border-t border-stone-800">
            <span class="text-sm text-stone-500 font-medium">Total</span>
            <span class="text-xl font-bold font-display text-stone-50">{new Intl.NumberFormat('es-CO', { style: 'currency', currency: expCurrency || data.trip.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(grandTotal)}</span>
          </div>
        {/if}

        {#if actionError}
          <div class="bg-red-950 border border-red-800/60 text-red-300 text-sm px-4 py-3 rounded-xl">{actionError}</div>
        {/if}

        <button
          onclick={submitExpense}
          disabled={submitting || submitDisabled}
          class="btn-primary w-full active:scale-[0.98] transition-transform"
        >{submitting ? 'Guardando…' : 'Guardar gasto'}</button>
      </div>
    </div>
  </div>
{/if}
{/if}
