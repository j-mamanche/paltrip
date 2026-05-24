import type { Expense, Balance, Transfer } from '$lib/types';
import { calculateSplit } from './split';

/**
 * Computes net balance per user across all confirmed deferred expenses.
 * net > 0  → user is owed money
 * net < 0  → user owes money
 */
export function computeBalances(expenses: Expense[]): Balance[] {
  const netMap = new Map<string, { name: string; net: number }>();

  const ensure = (id: string, name: string) => {
    if (!netMap.has(id)) netMap.set(id, { name, net: 0 });
  };

  for (const expense of expenses) {
    if (expense.status !== 'confirmed' || expense.settlement_type !== 'deferred') continue;
    if (!expense.participants?.length) continue;

    const payerId = expense.paid_by;
    const payerName = expense.payer?.name ?? payerId;
    ensure(payerId, payerName);

    // Use amount_base (converted to trip currency) for balance computation.
    // Falls back to amount_total for rows pre-dating the multicurrency migration.
    const baseAmount = expense.amount_base ?? expense.amount_total;

    const splits = calculateSplit({
      amount: baseAmount,
      paid_by: payerId,
      participants: expense.participants.map((p) => ({
        user_id: p.user_id,
        weight: p.weight
      }))
    });

    // Payer gets credit for the full amount
    netMap.get(payerId)!.net += baseAmount;

    // Each participant owes their share
    for (const split of splits) {
      const participantName = expense.participants.find((p) => p.user_id === split.user_id)?.member?.name ?? split.user_id;
      ensure(split.user_id, participantName);
      netMap.get(split.user_id)!.net -= split.share;
    }
  }

  return Array.from(netMap.entries()).map(([user_id, { name, net }]) => ({
    user_id,
    name,
    net: round2(net)
  }));
}

/**
 * Minimizes the number of transfers using a greedy creditor/debtor matching.
 * Complexity O(n log n). Produces at most n-1 transfers.
 */
export function optimizeTransfers(balances: Balance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net);

  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ ...b, net: Math.abs(b.net) }))
    .sort((a, b) => b.net - a.net);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = round2(Math.min(creditor.net, debtor.net));

    transfers.push({
      from_user: debtor.user_id,
      from_name: debtor.name,
      to_user: creditor.user_id,
      to_name: creditor.name,
      amount
    });

    creditor.net = round2(creditor.net - amount);
    debtor.net = round2(debtor.net - amount);

    if (creditor.net < 0.01) ci++;
    if (debtor.net < 0.01) di++;
  }

  return transfers;
}

/**
 * Rounds transfer amounts to the nearest granularity (default 1000 COP).
 * Distributes any residual to the last transfer in each creditor's group.
 */
export function roundTransfers(transfers: Transfer[], granularity = 1000): Transfer[] {
  return transfers.map((t) => ({
    ...t,
    amount: Math.round(t.amount / granularity) * granularity
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
