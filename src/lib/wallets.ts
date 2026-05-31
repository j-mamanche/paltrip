export interface Wallet {
  id: string;
  label: string;
  placeholder: string;
}

const W = (id: string, label: string, placeholder: string): Wallet => ({ id, label, placeholder });

export const WALLETS_BY_CURRENCY: Record<string, Wallet[]> = {
  COP: [
    W('nequi',       'Nequi',        'Número de celular'),
    W('breb',        'Bre-B',        'Número de celular'),
    W('daviplata',   'Daviplata',    'Número de celular'),
    W('bancolombia', 'Bancolombia',  'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  MXN: [
    W('mercadopago', 'Mercado Pago', 'Teléfono o usuario'),
    W('bbva',        'BBVA',         'Número de cuenta'),
    W('dimo',        'DiMo / CoDi',  'Número de celular'),
    W('banco',       'Banco / CLABE','CLABE interbancaria'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  ARS: [
    W('mercadopago', 'Mercado Pago', 'Alias o CVU'),
    W('brubank',     'Brubank',      'Alias o CVU'),
    W('naranjax',    'Naranja X',    'Alias o CVU'),
    W('banco',       'Banco / CBU',  'CBU o alias'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  BRL: [
    W('pix',         'PIX',          'CPF, teléfono o e-mail'),
    W('mercadopago', 'Mercado Pago', 'Usuario o teléfono'),
    W('nubank',      'Nubank',       'Chave PIX'),
    W('outro',       'Outro',        'Seu dado de pagamento'),
  ],
  CLP: [
    W('mach',        'MACH',         'RUT o usuario'),
    W('tenpo',       'Tenpo',        'RUT o usuario'),
    W('mercadopago', 'Mercado Pago', 'Teléfono o usuario'),
    W('banco',       'Banco',        'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  PEN: [
    W('yape',        'Yape',         'Número de celular'),
    W('plin',        'Plin',         'Número de celular'),
    W('banco',       'Banco',        'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  UYU: [
    W('mercadopago', 'Mercado Pago', 'Usuario o teléfono'),
    W('banco',       'Banco',        'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  BOB: [
    W('tigo',        'Tigo Money',   'Número de celular'),
    W('banco',       'Banco',        'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  CRC: [
    W('sinpe',       'SINPE Móvil',  'Número de celular'),
    W('banco',       'Banco',        'Número de cuenta'),
    W('otro',        'Otro',         'Tu dato de pago'),
  ],
  USD: [
    W('zelle',       'Zelle',        'Correo o teléfono'),
    W('venmo',       'Venmo',        '@usuario'),
    W('cashapp',     'Cash App',     '$cashtag'),
    W('paypal',      'PayPal',       'Correo electrónico'),
    W('wise',        'Wise',         'Usuario o correo'),
    W('otro',        'Otro',         'Your payment info'),
  ],
  EUR: [
    W('revolut',     'Revolut',      'Usuario o teléfono'),
    W('wise',        'Wise',         'Usuario o correo'),
    W('iban',        'IBAN',         'Número IBAN'),
    W('otro',        'Otro',         'Your payment info'),
  ],
  GBP: [
    W('monzo',       'Monzo',        'Usuario o número'),
    W('revolut',     'Revolut',      'Usuario o teléfono'),
    W('wise',        'Wise',         'Usuario o correo'),
    W('otro',        'Otro',         'Your payment info'),
  ],
};

const DEFAULT_WALLETS: Wallet[] = [
  W('banco', 'Banco / Transferencia', 'Número de cuenta'),
  W('otro',  'Otro',                  'Tu dato de pago'),
];

export function getWallets(currencyCode: string): Wallet[] {
  return WALLETS_BY_CURRENCY[currencyCode] ?? DEFAULT_WALLETS;
}

export function buildPaymentRef(wallet: Wallet | undefined, walletId: string, number: string): string | null {
  if (!number.trim()) return null;
  if (walletId === 'otro' || walletId === 'outro') return number.trim();
  return `${wallet?.label ?? walletId}: ${number.trim()}`;
}
