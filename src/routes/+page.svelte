<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { slide } from 'svelte/transition';
  import { CURRENCIES, fetchExchangeRate, groupCurrencies, currencyFlag } from '$lib/currencies';
  import { getWallets, buildPaymentRef } from '$lib/wallets';

  let creating = $state(false);
  let joining = $state(false);
  let activeSection = $state<'create' | 'join' | 'split' | null>(null);

  const EMOJI_POOL = [
    '😎','🤠','🥷','🧙','🦸','🧑‍🚀','🧑‍🎤','🧑‍🍳','🤹','🧗',
    '🦁','🐻','🦊','🐼','🦄','🐸','🐯','🐺','🦅','🐧',
    '🦋','🐙','🌈','⭐','🌊','🔥','💎','⚡','🌵','🎩',
  ];

  function randomSeven(): [string[], string] {
    const set = [...EMOJI_POOL].sort(() => Math.random() - 0.5).slice(0, 7);
    return [set, set[0]];
  }

  // ── Crear viaje ───────────────────────────────────────────────────────────
  let tripName = $state('');
  let tripEmoji = $state('✈️');
  let currency = $state('COP');
  let userName = $state('');
  const [_us, _ue] = randomSeven();
  let userEmojiSet = $state(_us);
  let userEmoji = $state(_ue);
  let userPaymentCountry = $state('COP');
  let userPaymentType = $state('nequi');
  let userPaymentNumber = $state('');
  const userWallets = $derived(getWallets(userPaymentCountry));

  // ── Unirse a viaje ────────────────────────────────────────────────────────
  let accessToken = $state('');
  let joinName = $state('');
  const [_js, _je] = randomSeven();
  let joinEmojiSet = $state(_js);
  let joinEmoji = $state(_je);
  let joinPaymentCountry = $state('COP');
  let joinPaymentType = $state('nequi');
  let joinPaymentNumber = $state('');
  const joinWallets = $derived(getWallets(joinPaymentCountry));

  function reshuffleUserEmojis() {
    const [set] = randomSeven();
    userEmojiSet = set;
    if (!set.includes(userEmoji)) userEmoji = set[0];
  }
  function reshuffleJoinEmojis() {
    const [set] = randomSeven();
    joinEmojiSet = set;
    if (!set.includes(joinEmoji)) joinEmoji = set[0];
  }

  let error = $state('');
  let lastTrip = $state<{ id: string; name: string; status: 'pending' | 'active' } | null>(null);
  let resolvedStatus = $state<'active' | 'pending' | 'newly_approved' | null>(null);

  // ── Calculadora ───────────────────────────────────────────────────────────
  type CalcMode = 'equal' | 'weighted' | 'itemized';
  type CalcPerson = { id: string; name: string; weight: number };
  type CalcItem = {
    id: string; desc: string; qty: number; amtStr: string;
    currency: string; rate: number; fetchingRate: boolean; rateError: string;
    assignees: string[];
  };

  let calcPeople = $state<CalcPerson[]>([]);
  let calcNewName = $state('');
  let calcMode = $state<CalcMode>('equal');
  let calcTotalStr = $state('');
  let calcAmtCurrency  = $state('COP');  // equal/weighted: currency of the total
  let calcBaseCurrency = $state('COP');  // itemized: result currency
  let calcItems = $state<CalcItem[]>([]);
  let calcTipStr = $state('');
  let calcShowTip = $state(false);
  let calcTipMode = $state<'prop' | 'flat'>('prop');
  let calcTipIncluded = $state(false);

  // Smarter amount parser: handles es-CO (1.234,56), en-US (1,234.56), and plain integers
  function parseAmount(s: string): number {
    const c = s.trim().replace(/[$€£¥₩₹\s]/g, '');
    if (!c) return 0;
    const lastDot = c.lastIndexOf('.'), lastComma = c.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1)
      return lastComma > lastDot
        ? parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0
        : parseFloat(c.replace(/,/g, '')) || 0;
    if (lastDot > -1) {
      const parts = c.split('.');
      return (parts.length > 2 || (parts.length === 2 && parts[1].length === 3))
        ? parseFloat(c.replace(/\./g, '')) || 0
        : parseFloat(c) || 0;
    }
    if (lastComma > -1) {
      const parts = c.split(',');
      return (parts.length > 2 || (parts.length === 2 && parts[1].length === 3))
        ? parseFloat(c.replace(/,/g, '')) || 0
        : parseFloat(c.replace(',', '.')) || 0;
    }
    return parseFloat(c) || 0;
  }

  // Live formatting while typing: adds thousands separators, preserves decimal part in progress
  function liveFormat(val: string): string {
    if (!val) return '';
    // Decimal separator just typed (e.g. "120," or "15.") — format integer, preserve separator
    if (/[.,]$/.test(val)) {
      const sep = val.slice(-1);
      const intDigits = val.slice(0, -1).replace(/\D/g, '');
      if (!intDigits) return sep;
      return new Intl.NumberFormat('es-CO').format(parseInt(intDigits)) + sep;
    }
    // Decimal digits being entered (e.g. "15,5" or "15.50") — max 2 decimal places
    const decMatch = val.match(/^([\d.,]*?)[.,](\d{1,2})$/);
    if (decMatch) {
      const intDigits = decMatch[1].replace(/\D/g, '');
      const decDigits = decMatch[2];
      const sep = val.lastIndexOf('.') > val.lastIndexOf(',') ? '.' : ',';
      const fmtInt = intDigits ? new Intl.NumberFormat('es-CO').format(parseInt(intDigits)) : '';
      return fmtInt + sep + decDigits;
    }
    // Pure integer or thousands-formatted number — apply grouping separators
    const digits = val.replace(/\D/g, '');
    if (!digits) return '';
    return new Intl.NumberFormat('es-CO').format(parseInt(digits));
  }

  function fmtNum(n: number, cur = 'COP') {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 2
    }).format(n);
  }
  function fmtInput(s: string, cur = 'COP'): string {
    const n = parseAmount(s);
    if (!n || n <= 0) return '';
    return new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0, maximumFractionDigits: cur === 'COP' ? 0 : 2
    }).format(n);
  }

  function calcAddPerson() {
    const name = calcNewName.trim();
    if (!name || calcPeople.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    const id = crypto.randomUUID();
    calcPeople = [...calcPeople, { id, name, weight: 1 }];
    calcItems = calcItems.map(i => ({ ...i, assignees: [...i.assignees, id] }));
    calcNewName = '';
  }
  function calcRemovePerson(id: string) {
    calcPeople = calcPeople.filter(p => p.id !== id);
    calcItems = calcItems.map(i => ({ ...i, assignees: i.assignees.filter(a => a !== id) }));
  }
  function calcSetWeight(id: string, w: number) {
    calcPeople = calcPeople.map(p => p.id !== id ? p : { ...p, weight: w });
  }
  function calcAddItem() {
    calcItems = [...calcItems, {
      id: crypto.randomUUID(), desc: '', qty: 1, amtStr: '',
      currency: calcBaseCurrency, rate: 1, fetchingRate: false, rateError: '',
      assignees: calcPeople.map(p => p.id)
    }];
  }
  function calcRemoveItem(id: string) {
    calcItems = calcItems.filter(i => i.id !== id);
  }
  function calcToggleAssignee(itemId: string, personId: string) {
    calcItems = calcItems.map(i => i.id !== itemId ? i : {
      ...i, assignees: i.assignees.includes(personId) ? i.assignees.filter(a => a !== personId) : [...i.assignees, personId]
    });
  }
  function calcUpdateItemAmt(id: string, raw: string) {
    calcItems = calcItems.map(i => i.id !== id ? i : { ...i, amtStr: liveFormat(raw) });
  }
  function calcBlurItemAmt(id: string, s: string) {
    const item = calcItems.find(i => i.id === id);
    calcItems = calcItems.map(i => i.id !== id ? i : { ...i, amtStr: fmtInput(s, item?.currency ?? calcBaseCurrency) });
  }
  function calcUpdateItemQty(id: string, delta: number) {
    calcItems = calcItems.map(i => i.id !== id ? i : { ...i, qty: Math.max(1, i.qty + delta) });
  }

  async function onCalcItemCurrencyChange(itemId: string, newCur: string) {
    calcItems = calcItems.map(i => i.id !== itemId ? i
      : { ...i, currency: newCur, rate: 1, fetchingRate: newCur !== calcBaseCurrency, rateError: '' });
    if (newCur === calcBaseCurrency) return;
    try {
      const rate = await fetchExchangeRate(newCur, calcBaseCurrency);
      calcItems = calcItems.map(i => i.id !== itemId ? i : { ...i, rate, fetchingRate: false });
    } catch {
      calcItems = calcItems.map(i => i.id !== itemId ? i
        : { ...i, rate: 0, fetchingRate: false, rateError: 'No se pudo obtener la tasa' });
    }
  }

  async function onCalcBaseCurrencyChange(newCur: string) {
    calcBaseCurrency = newCur;
    for (const item of calcItems) {
      if (item.currency !== newCur) onCalcItemCurrencyChange(item.id, item.currency);
      else calcItems = calcItems.map(i => i.id !== item.id ? i : { ...i, rate: 1, rateError: '' });
    }
  }

  const calcItemsTotal = $derived(calcItems.reduce((s, i) => s + i.qty * parseAmount(i.amtStr) * i.rate, 0));
  const calcTip = $derived(calcShowTip ? parseAmount(calcTipStr) : 0);
  const calcGrand = $derived.by(() => {
    const base = calcMode === 'itemized' ? calcItemsTotal : parseAmount(calcTotalStr);
    if (!calcShowTip || !calcTip) return base;
    return calcTipIncluded ? base : base + calcTip;
  });
  const calcHasInput = $derived(calcMode === 'itemized' ? calcItemsTotal > 0 : parseAmount(calcTotalStr) > 0);

  const calcResults = $derived.by(() => {
    if (calcPeople.length < 2 || calcGrand <= 0) return [];
    if (calcMode === 'equal') {
      const share = calcGrand / calcPeople.length;
      return calcPeople.map(p => ({ id: p.id, name: p.name, amount: share }));
    }
    if (calcMode === 'weighted') {
      const wSum = calcPeople.reduce((s, p) => s + p.weight, 0);
      if (!wSum) return [];
      return calcPeople.map(p => ({ id: p.id, name: p.name, amount: calcGrand * p.weight / wSum }));
    }
    // itemized — amounts converted to base currency via item.rate
    const totals: Record<string, number> = Object.fromEntries(calcPeople.map(p => [p.id, 0]));
    for (const item of calcItems) {
      const amtBase = item.qty * parseAmount(item.amtStr) * item.rate;
      if (!amtBase || !item.assignees.length) continue;
      const share = amtBase / item.assignees.length;
      for (const uid of item.assignees) { if (uid in totals) totals[uid] += share; }
    }
    if (calcShowTip && calcTip > 0 && calcItemsTotal > 0) {
      for (const p of calcPeople) {
        totals[p.id] += calcTipMode === 'flat'
          ? calcTip / calcPeople.length
          : calcTip * (totals[p.id] / calcItemsTotal);
      }
    }
    return calcPeople.map(p => ({ id: p.id, name: p.name, amount: totals[p.id] }));
  });

  onMount(async () => {
    const joinCode = new URLSearchParams(window.location.search).get('join');
    if (joinCode) {
      const knownTripId = localStorage.getItem(`pal_token_${joinCode}`);
      if (knownTripId && localStorage.getItem(`trip_${knownTripId}_user`)) {
        goto(`/trips/${knownTripId}`);
        return;
      }
      accessToken = joinCode;
      activeSection = 'join';
      window.history.replaceState({}, '', '/');
      return;
    }
    const raw = localStorage.getItem('pal_last_trip');
    if (!raw) return;
    try { lastTrip = JSON.parse(raw); } catch { return; }

    if (!lastTrip || lastTrip.status === 'active') {
      resolvedStatus = lastTrip ? 'active' : null;
      return;
    }

    // status === 'pending': verificar si fue aprobado en el servidor
    const memberId = localStorage.getItem(`trip_${lastTrip.id}_user`);
    if (!memberId) return;
    try {
      const res = await fetch(`/api/trips/${lastTrip.id}/member-status`, {
        headers: { 'X-Member-Id': memberId }
      });
      if (res.ok) {
        const { status } = await res.json();
        if (status === 'active') {
          resolvedStatus = 'newly_approved';
          localStorage.setItem('pal_last_trip', JSON.stringify({ ...lastTrip, status: 'active' }));
        } else {
          resolvedStatus = 'pending';
        }
      }
    } catch { resolvedStatus = 'pending'; }
  });

  // ── Shared helpers ────────────────────────────────────────────────────────
  const travelEmojis = ['✈️','🏖️','🏔️','🌊','🏕️','🗺️','🛻','⛺','🎒','🚂','🚢','🏄','🎿','🌴','🗽','🏯'];


  async function createTrip() {
    if (!tripName.trim() || !userName.trim()) return;
    creating = true; error = '';
    try {
      const res = await fetch('/api/trips', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${tripEmoji} ${tripName.trim()}`, currency, userName: `${userEmoji} ${userName.trim()}`, paymentRef: buildPaymentRef(userWallets.find(w => w.id === userPaymentType), userPaymentType, userPaymentNumber) })
      });
      if (!res.ok) throw new Error((await res.json()).message ?? await res.text());
      const { trip, member } = await res.json();
      localStorage.setItem(`trip_${trip.id}_user`, member.id);
      localStorage.setItem('pal_last_trip', JSON.stringify({ id: trip.id, name: trip.name, status: 'active' }));
      localStorage.setItem(`pal_token_${trip.access_token}`, trip.id);
      goto(`/trips/${trip.id}`);
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Error al crear el viaje';
    } finally { creating = false; }
  }

  async function joinTrip() {
    if (!accessToken.trim() || !joinName.trim()) return;
    joining = true; error = '';
    try {
      const res = await fetch('/api/trips/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken.trim(), name: `${joinEmoji} ${joinName.trim()}`, paymentRef: buildPaymentRef(joinWallets.find(w => w.id === joinPaymentType), joinPaymentType, joinPaymentNumber) })
      });
      if (!res.ok) throw new Error((await res.json()).message ?? await res.text());
      const { trip, member } = await res.json();
      localStorage.setItem(`trip_${trip.id}_user`, member.id);
      localStorage.setItem('pal_last_trip', JSON.stringify({ id: trip.id, name: trip.name, status: 'pending' }));
      localStorage.setItem(`pal_token_${accessToken.trim()}`, trip.id);
      goto(`/trips/${trip.id}`);
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Error al entrar al viaje';
    } finally { joining = false; }
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center px-4 py-16">
  <div class="w-full max-w-sm space-y-8">

    <div class="text-center space-y-2">
      <h1 class="font-display font-bold text-5xl tracking-tight text-stone-50">Pa'l Trip</h1>
      <p class="text-stone-500 text-sm">Organiza y divide los gastos de tu grupo.</p>
    </div>

    {#if error}
      <div class="bg-red-950 border border-red-800/60 text-red-300 text-sm px-4 py-3 rounded-xl">{error}</div>
    {/if}

    {#if resolvedStatus === 'active' && lastTrip}
      <a href="/trips/{lastTrip.id}"
         class="flex items-center gap-3 px-4 py-3 rounded-2xl bg-brand-950/50 border border-brand-800/60
                text-stone-200 hover:bg-brand-900/50 transition-colors duration-150 group">
        <span class="text-xl">✈️</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-stone-500">Continuar en</p>
          <p class="text-sm font-semibold font-display truncate">{lastTrip.name}</p>
        </div>
        <span class="text-stone-600 group-hover:text-brand-400 transition-colors">→</span>
      </a>
    {:else if resolvedStatus === 'newly_approved' && lastTrip}
      <a href="/trips/{lastTrip.id}"
         class="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-950/60 border border-emerald-700/60
                text-stone-200 hover:bg-emerald-900/50 transition-colors duration-150 group">
        <span class="text-xl">🎉</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-emerald-400 font-medium">¡Solicitud aceptada!</p>
          <p class="text-sm font-semibold font-display truncate">Unirse a {lastTrip.name}</p>
        </div>
        <span class="text-stone-600 group-hover:text-emerald-400 transition-colors">→</span>
      </a>
    {:else if resolvedStatus === 'pending' && lastTrip}
      <div class="flex items-center gap-3 px-4 py-3 rounded-2xl bg-stone-800/60 border border-stone-700/60 text-stone-400">
        <span class="text-xl">⏳</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-stone-500">Solicitud en curso</p>
          <p class="text-sm font-semibold font-display truncate text-stone-300">{lastTrip.name}</p>
        </div>
      </div>
    {/if}

    <div class="space-y-3">

      <!-- ── Calculadora rápida ─────────────────────────────────────────── -->
      <div class="rounded-2xl border overflow-hidden transition-colors duration-200
        {activeSection === 'split'
          ? 'bg-emerald-950/40 border-emerald-900/50'
          : 'bg-emerald-950/20 border-emerald-900/30'}">

        <button
          onclick={() => (activeSection = activeSection === 'split' ? null : 'split')}
          class="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-200
            {activeSection === 'split' ? 'bg-emerald-500/8' : 'hover:bg-emerald-500/6'}"
        >
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 transition-colors duration-200
            {activeSection === 'split'
              ? 'bg-emerald-500/25 border border-emerald-500/40'
              : 'bg-emerald-500/12 border border-emerald-500/20'}">
            🧮
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-display font-semibold text-stone-50 text-base leading-tight">Pa'l Gasto</h2>
            <p class="text-stone-500 text-xs mt-0.5">Divide la cuenta fácil y rápido.</p>
          </div>
          <span class="text-2xl font-light leading-none transition-all duration-200
            {activeSection === 'split' ? 'rotate-45 text-emerald-400' : 'text-stone-600'}">+</span>
        </button>

        {#if activeSection === 'split'}
          <div transition:slide={{ duration: 180 }} class="px-5 pb-5 space-y-4 border-t border-emerald-900/40 pt-4">

            <!-- Personas -->
            <div class="space-y-2">
              <p class="text-xs text-stone-500 font-medium">¿Quiénes están?</p>
              <div class="flex gap-2">
                <input
                  bind:value={calcNewName}
                  placeholder="Nombre"
                  class="input flex-1 py-2 text-sm"
                  onkeydown={(e) => { if (e.key === 'Enter') calcAddPerson(); }}
                />
                <button
                  onclick={calcAddPerson}
                  disabled={!calcNewName.trim()}
                  class="btn-secondary px-3 py-2 text-sm disabled:opacity-40"
                >+</button>
              </div>
              {#if calcPeople.length > 0}
                <div class="flex flex-wrap gap-1.5">
                  {#each calcPeople as p}
                    <span class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-stone-800 border border-stone-700 text-stone-200">
                      {p.name}
                      <button onclick={() => calcRemovePerson(p.id)} class="text-stone-600 hover:text-red-400 transition leading-none">×</button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>

            {#if calcPeople.length >= 2}
              <!-- Modo -->
              <div class="flex gap-1.5" transition:slide={{ duration: 140 }}>
                {#each ([
                  { val: 'equal',    label: 'Igual',      hint: 'A partes iguales' },
                  { val: 'weighted', label: 'Porciones',   hint: 'Alguien consume más' },
                  { val: 'itemized', label: 'Detallado',   hint: 'Ítem por ítem' }
                ] as const) as m}
                  <button
                    onclick={() => (calcMode = m.val)}
                    class="flex-1 text-center py-2 rounded-xl border text-xs font-medium transition
                      {calcMode === m.val
                        ? 'bg-emerald-500/15 border-emerald-600/50 text-emerald-300'
                        : 'border-stone-700 bg-stone-800 text-stone-500 hover:text-stone-300'}"
                  >{m.label}</button>
                {/each}
              </div>

              <!-- Monto total (igual + porciones) -->
              {#if calcMode !== 'itemized'}
                <div class="flex gap-2" transition:slide={{ duration: 140 }}>
                  <div class="flex-1 min-w-0">
                    <input
                      value={calcTotalStr}
                      oninput={(e) => { calcTotalStr = liveFormat((e.target as HTMLInputElement).value); }}
                      onfocus={(e) => (e.target as HTMLInputElement).select()}
                      onblur={() => { calcTotalStr = fmtInput(calcTotalStr, calcAmtCurrency); }}
                      placeholder="Monto total"
                      type="text"
                      inputmode="decimal"
                      class="input"
                    />
                  </div>
                  <select
                    value={calcAmtCurrency}
                    onchange={(e) => { calcAmtCurrency = (e.target as HTMLSelectElement).value; calcTotalStr = fmtInput(calcTotalStr, calcAmtCurrency); }}
                    class="input !w-24 shrink-0 text-xs"
                  >
                    {#each groupCurrencies() as grp}
                      <optgroup label={grp.label}>
                        {#each grp.currencies as c}
                          <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                        {/each}
                      </optgroup>
                    {/each}
                  </select>
                </div>
              {/if}

              <!-- Porciones: selector por persona -->
              {#if calcMode === 'weighted' && parseAmount(calcTotalStr) > 0}
                <div class="space-y-3" transition:slide={{ duration: 140 }}>
                  {#each calcPeople as p}
                    {@const wSum = calcPeople.reduce((s, x) => s + x.weight, 0)}
                    <div class="space-y-1.5">
                      <div class="flex justify-between px-0.5">
                        <span class="text-sm text-stone-300 font-medium">{p.name}</span>
                        <div class="flex items-center gap-2">
                          <span class="text-[11px] text-stone-500 tabular-nums">{p.weight}×</span>
                          <span class="text-sm font-semibold text-stone-200">{fmtNum(calcGrand * p.weight / wSum, calcAmtCurrency)}</span>
                        </div>
                      </div>
                      <datalist id="ticks-{p.id}">
                        {#each [1, 2, 3, 4] as t}<option value={t}></option>{/each}
                      </datalist>
                      <input
                        type="range" min="1" max="4" step="0.25"
                        list="ticks-{p.id}"
                        value={Math.min(p.weight, 4)}
                        oninput={(e) => calcSetWeight(p.id, parseFloat((e.target as HTMLInputElement).value))}
                        class="w-full cursor-pointer accent-emerald-500 h-1.5 block"
                      />
                      <div class="flex justify-between text-[9px] text-stone-600 px-0.5">
                        {#each [1, 2, 3, 4] as t}<span>{t}×</span>{/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Ítems (detallado) -->
              {#if calcMode === 'itemized'}
                <div class="space-y-2" transition:slide={{ duration: 140 }}>
                  <!-- Base currency selector -->
                  <div class="flex items-center gap-2 text-xs text-stone-500">
                    <span>Resultado en</span>
                    <select
                      value={calcBaseCurrency}
                      onchange={(e) => onCalcBaseCurrencyChange((e.target as HTMLSelectElement).value)}
                      class="input py-1 text-xs !w-28"
                    >
                      {#each groupCurrencies() as grp}
                        <optgroup label={grp.label}>
                          {#each grp.currencies as c}
                            <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                          {/each}
                        </optgroup>
                      {/each}
                    </select>
                  </div>
                  {#if calcItems.length === 0}
                    <div class="flex flex-col items-center py-6 rounded-xl border border-dashed border-stone-700 text-stone-600">
                      <span class="text-xl mb-1">🧾</span>
                      <span class="text-xs">Agrega los ítems</span>
                    </div>
                  {:else}
                    <div class="space-y-2">
                      {#each calcItems as item (item.id)}
                        <div class="bg-stone-800 rounded-xl p-3 space-y-2">
                          <div class="flex items-center gap-2">
                            <input
                              value={item.desc}
                              oninput={(e) => { calcItems = calcItems.map(i => i.id !== item.id ? i : { ...i, desc: (e.target as HTMLInputElement).value }) }}
                              placeholder="Nombre del ítem"
                              class="input flex-1 py-1.5 text-xs"
                            />
                            <button
                              onclick={() => calcRemoveItem(item.id)}
                              class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-stone-600 hover:text-red-400 transition"
                            >✕</button>
                          </div>
                          <div class="flex items-center gap-2">
                            <div class="flex items-center gap-0.5 bg-stone-700/60 rounded-lg px-1 shrink-0">
                              <button onclick={() => calcUpdateItemQty(item.id, -1)} class="w-6 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 transition">−</button>
                              <span class="text-xs font-semibold text-stone-100 min-w-[1.2rem] text-center">{item.qty}</span>
                              <button onclick={() => calcUpdateItemQty(item.id, 1)} class="w-6 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 transition">+</button>
                            </div>
                            <input
                              value={item.amtStr}
                              oninput={(e) => calcUpdateItemAmt(item.id, (e.target as HTMLInputElement).value)}
                              onblur={(e) => calcBlurItemAmt(item.id, (e.target as HTMLInputElement).value)}
                              onfocus={(e) => (e.target as HTMLInputElement).select()}
                              placeholder="Precio unitario"
                              type="text"
                              inputmode="decimal"
                              class="input flex-1 py-1.5 text-xs"
                            />
                            <select
                              value={item.currency}
                              onchange={(e) => onCalcItemCurrencyChange(item.id, (e.target as HTMLSelectElement).value)}
                              class="input !w-24 shrink-0 text-xs py-1.5"
                            >
                              {#each groupCurrencies(calcBaseCurrency) as grp}
                                <optgroup label={grp.label}>
                                  {#each grp.currencies as c}
                                    <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                                  {/each}
                                </optgroup>
                              {/each}
                            </select>
                          </div>
                          <!-- Exchange rate row (only when item currency differs from base) -->
                          {#if item.currency !== calcBaseCurrency}
                            <div class="flex items-center gap-1.5 text-xs text-stone-500 pl-0.5" transition:slide={{ duration: 120 }}>
                              {#if item.fetchingRate}
                                <span class="text-stone-600 italic">Obteniendo tasa…</span>
                              {:else}
                                <span>1 {item.currency} =</span>
                                <input
                                  type="number"
                                  value={item.rate > 0 ? item.rate : ''}
                                  oninput={(e) => { calcItems = calcItems.map(i => i.id !== item.id ? i : { ...i, rate: parseFloat((e.target as HTMLInputElement).value) || 0 }); }}
                                  placeholder="tasa"
                                  class="input w-24 py-0.5 text-xs"
                                />
                                <span>{calcBaseCurrency}</span>
                                {#if item.rateError}
                                  <span class="text-amber-500">{item.rateError}</span>
                                {/if}
                              {/if}
                            </div>
                          {/if}
                          <!-- Subtotal (show original currency amount when qty > 1) -->
                          {#if item.qty > 1 && parseAmount(item.amtStr) > 0}
                            <div class="flex items-center gap-1.5 text-xs text-stone-600 pl-0.5">
                              <span>={item.qty} × {fmtNum(parseAmount(item.amtStr), item.currency)}</span>
                              {#if item.currency !== calcBaseCurrency && item.rate > 0}
                                <span class="text-stone-700">≈ {fmtNum(item.qty * parseAmount(item.amtStr) * item.rate, calcBaseCurrency)}</span>
                              {/if}
                            </div>
                          {/if}
                          <div class="flex flex-wrap gap-1">
                            {#each calcPeople as p}
                              <button
                                onclick={() => calcToggleAssignee(item.id, p.id)}
                                class="text-xs px-2 py-0.5 rounded-full border font-medium transition
                                  {item.assignees.includes(p.id)
                                    ? 'bg-emerald-500/15 border-emerald-600/50 text-emerald-300'
                                    : 'border-stone-600 bg-stone-700 text-stone-500 hover:text-stone-300'}"
                              >{p.name}</button>
                            {/each}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  <button
                    onclick={calcAddItem}
                    class="w-full py-2 rounded-xl border border-dashed border-stone-700 hover:border-emerald-600/50 text-xs text-stone-500 hover:text-emerald-400 transition"
                  >+ Agregar ítem</button>
                </div>
              {/if}

              <!-- Propina -->
              {#if calcHasInput}
                <div transition:slide={{ duration: 120 }}>
                  <button
                    onclick={() => { calcShowTip = !calcShowTip; if (!calcShowTip) calcTipStr = ''; }}
                    class="text-xs font-medium transition-colors {calcShowTip ? 'text-stone-400' : 'text-stone-600 hover:text-emerald-400'}"
                  >{calcShowTip ? '− Quitar propina' : '+ Agregar propina'}</button>
                  {#if calcShowTip}
                    <div class="mt-2.5 space-y-2" transition:slide={{ duration: 120 }}>
                      <div class="flex gap-1.5">
                        {#each ([{ val: 'prop', label: 'Proporcional' }, { val: 'flat', label: 'Por cabeza' }] as const) as tm}
                          <button
                            onclick={() => (calcTipMode = tm.val)}
                            class="flex-1 py-1.5 rounded-xl border text-xs font-medium transition
                              {calcTipMode === tm.val
                                ? 'bg-emerald-500/15 border-emerald-600/50 text-emerald-300'
                                : 'border-stone-700 bg-stone-800 text-stone-500'}"
                          >{tm.label}</button>
                        {/each}
                      </div>
                      <button
                        onclick={() => { calcTipIncluded = !calcTipIncluded; calcTipStr = ''; }}
                        class="text-xs px-3 py-1 rounded-full border transition
                          {calcTipIncluded
                            ? 'bg-emerald-500/15 border-emerald-600/50 text-emerald-300'
                            : 'border-stone-700 bg-stone-800 text-stone-500 hover:text-stone-300'}"
                      >{calcTipIncluded ? 'Incluida en total' : 'Adicional al total'}</button>
                      <input
                        value={calcTipStr}
                        oninput={(e) => { calcTipStr = liveFormat((e.target as HTMLInputElement).value); }}
                        onfocus={(e) => (e.target as HTMLInputElement).select()}
                        onblur={() => { calcTipStr = fmtInput(calcTipStr, calcMode === 'itemized' ? calcBaseCurrency : calcAmtCurrency); }}
                        placeholder="Monto de propina"
                        type="text"
                        inputmode="decimal"
                        class="input"
                      />
                      {#if calcTipIncluded && calcTip > 0}
                        {@const resCur = calcMode === 'itemized' ? calcBaseCurrency : calcAmtCurrency}
                        <p class="text-xs text-stone-500 px-1" transition:slide={{ duration: 100 }}>
                          De los cuales <span class="text-stone-300 font-medium">{fmtNum(calcTip, resCur)}</span> son propina
                        </p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Resultado -->
              {#if calcResults.length > 0}
                {@const resCur = calcMode === 'itemized' ? calcBaseCurrency : calcAmtCurrency}
                <div class="rounded-xl bg-emerald-950/40 border border-emerald-900/40 px-4 py-3 space-y-2" transition:slide={{ duration: 140 }}>
                  <p class="text-xs text-stone-500 font-medium uppercase tracking-wide">Resultado</p>
                  {#each calcResults as r}
                    <div class="flex justify-between items-baseline">
                      <span class="text-sm text-stone-300">{r.name}</span>
                      <span class="font-bold text-stone-50 font-display">{fmtNum(r.amount, resCur)}</span>
                    </div>
                  {/each}
                  {#if calcGrand > 0}
                    <div class="flex justify-between items-baseline border-t border-emerald-900/40 pt-2 mt-1">
                      <span class="text-xs text-stone-600">Total</span>
                      <span class="text-sm text-stone-500">{fmtNum(calcGrand, resCur)}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}

          </div>
        {/if}
      </div>

      <!-- ── Crear un viaje ──────────────────────────────────────────────── -->
      <div class="rounded-2xl border overflow-hidden transition-colors duration-200
        {activeSection === 'create'
          ? 'bg-brand-950/60 border-brand-900/50'
          : 'bg-brand-950/30 border-brand-900/30'}">

        <button
          onclick={() => (activeSection = activeSection === 'create' ? null : 'create')}
          class="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-200
            {activeSection === 'create' ? 'bg-brand-500/10' : 'hover:bg-brand-500/8'}"
        >
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 transition-colors duration-200
            {activeSection === 'create'
              ? 'bg-brand-500/30 border border-brand-500/40'
              : 'bg-brand-500/15 border border-brand-500/20'}">
            ✈️
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-display font-semibold text-stone-50 text-base leading-tight">Pa'l Trip</h2>
            <p class="text-stone-500 text-xs mt-0.5">Arma tu grupo y lleva el control de gastos.</p>
          </div>
          <span class="text-2xl font-light leading-none transition-all duration-200
            {activeSection === 'create' ? 'rotate-45 text-brand-400' : 'text-stone-600'}">+</span>
        </button>

        {#if activeSection === 'create'}
          <div transition:slide={{ duration: 180 }} class="px-5 pb-5 space-y-4 border-t border-brand-900/40 pt-4">

            <div class="space-y-2">
              <div class="flex gap-1.5">
                {#each userEmojiSet as em}
                  <button type="button" onclick={() => (userEmoji = em)}
                    class="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition shrink-0
                      {userEmoji === em ? 'bg-brand-500/25 ring-2 ring-brand-500/60' : 'bg-stone-800 hover:bg-stone-700'}"
                  >{em}</button>
                {/each}
                <button type="button" onclick={reshuffleUserEmojis}
                  class="w-9 h-9 rounded-xl text-base flex items-center justify-center transition shrink-0 bg-stone-800 hover:bg-stone-700 text-stone-500 hover:text-stone-300"
                  title="Otros emojis"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <polyline points="3 3 3 8 8 8"/>
                  </svg>
                </button>
              </div>
              <input bind:value={userName} placeholder="Tu nombre" class="input" type="text" />
            </div>

            <div class="space-y-2">
              <p class="text-xs text-stone-500 font-medium">Billetera o cuenta <span class="text-stone-700">(opcional)</span></p>
              <div class="flex gap-2">
                <select bind:value={userPaymentCountry}
                        onchange={() => { userPaymentType = getWallets(userPaymentCountry)[0].id; userPaymentNumber = ''; }}
                        class="input !w-auto shrink-0 text-sm">
                  {#each CURRENCIES as c}
                    <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                  {/each}
                </select>
                <select bind:value={userPaymentType} class="input !w-auto shrink-0 text-sm">
                  {#each userWallets as w}
                    <option value={w.id}>{w.label}</option>
                  {/each}
                </select>
              </div>
              <input bind:value={userPaymentNumber}
                     placeholder={userWallets.find(w => w.id === userPaymentType)?.placeholder ?? 'Tu dato de pago'}
                     class="input" type="text" />
            </div>

            <div class="h-px bg-brand-900/40"></div>

            <div class="rounded-xl border border-brand-800/50 bg-brand-950/50 p-3 space-y-2.5">
              <div class="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {#each travelEmojis as em}
                  <button type="button" onclick={() => (tripEmoji = em)}
                    class="shrink-0 w-9 h-9 rounded-xl text-lg flex items-center justify-center transition
                      {tripEmoji === em ? 'bg-brand-500/25 ring-2 ring-brand-500/60' : 'bg-stone-800/80 hover:bg-stone-700'}"
                  >{em}</button>
                {/each}
              </div>
              <input bind:value={tripName} placeholder="Nombre del viaje" class="input font-display text-base !bg-stone-900/60 !border-brand-800/40 focus:!border-transparent" type="text" />
            </div>

            <select bind:value={currency} class="input">
              {#each groupCurrencies() as grp}
                <optgroup label={grp.label}>
                  {#each grp.currencies as c}
                    <option value={c.code}>{currencyFlag(c.code)} {c.code} — {c.name}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>

            <button onclick={createTrip} disabled={creating || !tripName.trim() || !userName.trim()} class="btn-primary w-full">
              {creating ? 'Creando…' : 'Crear viaje'}
            </button>
          </div>
        {/if}
      </div>

      <!-- ── Unirse a un viaje ───────────────────────────────────────────── -->
      <div class="rounded-2xl border overflow-hidden transition-colors duration-200
        {activeSection === 'join'
          ? 'bg-stone-800 border-stone-700'
          : 'bg-stone-900 border-stone-800'}">

        <button
          onclick={() => (activeSection = activeSection === 'join' ? null : 'join')}
          class="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors duration-200
            {activeSection === 'join' ? '' : 'hover:bg-stone-800/60'}"
        >
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 transition-colors duration-200
            {activeSection === 'join' ? 'bg-stone-600 border border-stone-500' : 'bg-stone-700 border border-stone-600'}">
            🎟️
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-display font-semibold text-stone-50 text-base leading-tight">Unirse al viaje</h2>
            <p class="text-stone-500 text-xs mt-0.5">Entra con el código que te compartieron.</p>
          </div>
          <span class="text-2xl font-light leading-none transition-all duration-200
            {activeSection === 'join' ? 'rotate-45 text-stone-300' : 'text-stone-600'}">+</span>
        </button>

        {#if activeSection === 'join'}
          <div transition:slide={{ duration: 180 }} class="px-5 pb-5 space-y-4 border-t border-stone-700/60 pt-4">

            <div class="space-y-2">
              <div class="flex gap-1.5">
                {#each joinEmojiSet as em}
                  <button type="button" onclick={() => (joinEmoji = em)}
                    class="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition shrink-0
                      {joinEmoji === em ? 'bg-brand-500/25 ring-2 ring-brand-500/60' : 'bg-stone-800 hover:bg-stone-700'}"
                  >{em}</button>
                {/each}
                <button type="button" onclick={reshuffleJoinEmojis}
                  class="w-9 h-9 rounded-xl text-base flex items-center justify-center transition shrink-0 bg-stone-800 hover:bg-stone-700 text-stone-500 hover:text-stone-300"
                  title="Otros emojis"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <polyline points="3 3 3 8 8 8"/>
                  </svg>
                </button>
              </div>
              <input bind:value={joinName} placeholder="Tu nombre" class="input" type="text" />
            </div>

            <div class="space-y-2">
              <p class="text-xs text-stone-500 font-medium">Billetera o cuenta <span class="text-stone-700">(opcional)</span></p>
              <div class="flex gap-2">
                <select bind:value={joinPaymentCountry}
                        onchange={() => { joinPaymentType = getWallets(joinPaymentCountry)[0].id; joinPaymentNumber = ''; }}
                        class="input !w-auto shrink-0 text-sm">
                  {#each CURRENCIES as c}
                    <option value={c.code}>{currencyFlag(c.code)} {c.code}</option>
                  {/each}
                </select>
                <select bind:value={joinPaymentType} class="input !w-auto shrink-0 text-sm">
                  {#each joinWallets as w}
                    <option value={w.id}>{w.label}</option>
                  {/each}
                </select>
              </div>
              <input bind:value={joinPaymentNumber}
                     placeholder={joinWallets.find(w => w.id === joinPaymentType)?.placeholder ?? 'Tu dato de pago'}
                     class="input" type="text" />
            </div>

            <div class="h-px bg-stone-700/60"></div>

            <input bind:value={accessToken} placeholder="Código del viaje" class="input" type="text" />

            <button onclick={joinTrip} disabled={joining || !accessToken.trim() || !joinName.trim()} class="btn-secondary w-full">
              {joining ? 'Entrando…' : 'Entrar al viaje'}
            </button>
          </div>
        {/if}
      </div>

    </div>

    <footer class="text-center text-stone-700 text-xs">
      <a href="/privacidad" class="hover:text-stone-500 transition underline underline-offset-2">
        Política de datos personales
      </a>
    </footer>

  </div>
</main>
