export interface Currency {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: Currency[] = [
  // Latinoamérica
  { code: 'COP', name: 'Peso colombiano',      symbol: '$'   },
  { code: 'MXN', name: 'Peso mexicano',         symbol: '$'   },
  { code: 'ARS', name: 'Peso argentino',        symbol: '$'   },
  { code: 'BRL', name: 'Real brasileño',        symbol: 'R$'  },
  { code: 'CLP', name: 'Peso chileno',          symbol: '$'   },
  { code: 'PEN', name: 'Sol peruano',           symbol: 'S/'  },
  { code: 'UYU', name: 'Peso uruguayo',         symbol: '$U'  },
  { code: 'BOB', name: 'Boliviano',             symbol: 'Bs.' },
  { code: 'CRC', name: 'Colón costarricense',   symbol: '₡'   },
  { code: 'DOP', name: 'Peso dominicano',       symbol: 'RD$' },
  { code: 'GTQ', name: 'Quetzal guatemalteco',  symbol: 'Q'   },
  { code: 'PYG', name: 'Guaraní paraguayo',     symbol: '₲'   },
  // Norteamérica
  { code: 'USD', name: 'Dólar estadounidense',  symbol: '$'   },
  { code: 'CAD', name: 'Dólar canadiense',      symbol: 'CA$' },
  // Europa
  { code: 'EUR', name: 'Euro',                  symbol: '€'   },
  { code: 'GBP', name: 'Libra esterlina',       symbol: '£'   },
  { code: 'CHF', name: 'Franco suizo',          symbol: 'CHF' },
  { code: 'SEK', name: 'Corona sueca',          symbol: 'kr'  },
  { code: 'NOK', name: 'Corona noruega',        symbol: 'kr'  },
  // Asia & Pacífico
  { code: 'JPY', name: 'Yen japonés',           symbol: '¥'   },
  { code: 'CNY', name: 'Yuan chino',            symbol: '¥'   },
  { code: 'KRW', name: 'Won surcoreano',        symbol: '₩'   },
  { code: 'INR', name: 'Rupia india',           symbol: '₹'   },
  { code: 'THB', name: 'Baht tailandés',        symbol: '฿'   },
  { code: 'SGD', name: 'Dólar de Singapur',     symbol: 'S$'  },
  { code: 'VND', name: 'Dong vietnamita',       symbol: '₫'   },
  { code: 'AED', name: 'Dírham de EAU',         symbol: 'د.إ' },
  { code: 'AUD', name: 'Dólar australiano',     symbol: 'A$'  },
  // África
  { code: 'ZAR', name: 'Rand sudafricano',      symbol: 'R'   },
];

export const CURRENCY_MAP = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): Currency | undefined {
  return CURRENCY_MAP.get(code);
}

/** Convert a currency code to its country flag emoji (e.g. 'COP' → '🇨🇴') */
export function currencyFlag(code: string): string {
  const cc = code.slice(0, 2).toUpperCase();
  return [...cc].map(c => String.fromCodePoint(c.codePointAt(0)! - 65 + 0x1F1E6)).join('');
}

export interface CurrencyGroup {
  label: string;
  currencies: Currency[];
}

const LATAM_CODES  = ['COP','MXN','ARS','BRL','CLP','PEN','UYU','BOB','CRC','DOP','GTQ','PYG'];
const PRIORITY     = ['COP','USD','EUR','MXN'];

/**
 * Returns currencies sorted into optgroup-ready groups.
 * primaryCode (e.g. the trip's base currency) is shown first in its own group.
 */
export function groupCurrencies(primaryCode?: string): CurrencyGroup[] {
  const primary = primaryCode && CURRENCY_MAP.has(primaryCode) ? primaryCode : null;

  // Priority row: primary first, then COP/USD/EUR/MXN, deduped
  const topCodes = primary
    ? [primary, ...PRIORITY.filter(c => c !== primary)]
    : PRIORITY;

  const topGroup    = topCodes.map(c => CURRENCY_MAP.get(c)).filter(Boolean) as Currency[];
  const topSet      = new Set(topCodes);

  const latamGroup  = LATAM_CODES
    .filter(c => !topSet.has(c))
    .map(c => CURRENCY_MAP.get(c)).filter(Boolean) as Currency[];

  const worldGroup  = CURRENCIES
    .filter(c => !topSet.has(c.code) && !LATAM_CODES.includes(c.code));

  const groups: CurrencyGroup[] = [];
  if (topGroup.length)  groups.push({ label: primary ? `★ ${primary} + principales` : '★ Principales', currencies: topGroup });
  if (latamGroup.length) groups.push({ label: 'Latinoamérica', currencies: latamGroup });
  if (worldGroup.length) groups.push({ label: 'Resto del mundo', currencies: worldGroup });
  return groups;
}

/** Fetch exchange rate from fawazahmed0/currency-api (CDN, free, 170+ currencies) */
export async function fetchExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rate = data[from.toLowerCase()]?.[to.toLowerCase()];
  if (!rate || typeof rate !== 'number') throw new Error(`Rate not found: ${from}→${to}`);
  return rate;
}
