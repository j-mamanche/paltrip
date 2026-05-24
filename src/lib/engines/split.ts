import type { SplitInput, SplitResult } from '$lib/types';

/**
 * Calculates each participant's share using weights.
 * Returns exact fractional amounts that sum precisely to the total.
 * The last participant absorbs any floating-point residual.
 */
export function calculateSplit(input: SplitInput): SplitResult[] {
  const { amount, participants } = input;

  if (participants.length === 0) return [];

  const totalWeight = participants.reduce((sum, p) => sum + (p.weight ?? 1), 0);
  const results: SplitResult[] = [];
  let allocated = 0;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const weight = p.weight ?? 1;
    const isLast = i === participants.length - 1;
    const share = isLast
      ? round2(amount - allocated)
      : round2((weight / totalWeight) * amount);

    results.push({ user_id: p.user_id, share });
    allocated += share;
  }

  return results;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
