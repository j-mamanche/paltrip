export type TripRole = 'admin' | 'member';
export type MemberStatus = 'pending' | 'active' | 'removed';
export type SettlementType = 'immediate' | 'deferred';
export type ExpenseStatus = 'draft' | 'confirmed';
export type SettlementStatus = 'pending' | 'paid';

export interface Trip {
  id: string;
  name: string;
  currency: string;
  access_token: string;
  created_at: string;
}

// Identity lives in trip_users — no global users table
export interface TripUser {
  id: string;
  trip_id: string;
  name: string;
  payment_ref: string | null; // Bre-B / Nequi / Cuenta
  role: TripRole;
  status: MemberStatus;
  joined_at: string;
}

export interface ExpenseItem {
  id: string;
  expense_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: string;
  assignments?: { user_id: string }[];
}

export interface ExpenseParticipant {
  id: string;
  expense_id: string;
  user_id: string; // references trip_users.id
  weight: number;
  member?: TripUser;
}

export interface Expense {
  id: string;
  trip_id: string;
  description: string;
  amount_total: number;       // original amount in `currency`
  currency: string;           // original currency of the expense
  original_currency?: string; // same as currency (explicit)
  original_amount?: number;   // same as amount_total (explicit)
  exchange_rate: number;      // rate from currency → trip base currency
  amount_base: number;        // amount_total * exchange_rate (used by balance engine)
  paid_by: string; // references trip_users.id
  settlement_type: SettlementType;
  category: string;
  split_mode: 'equal' | 'weighted' | 'itemized';
  tip_amount: number;
  tip_mode: 'proportional' | 'flat';
  image_url: string | null;
  status: ExpenseStatus;
  created_at: string;
  payer?: TripUser;
  participants?: ExpenseParticipant[];
  items?: ExpenseItem[];
}

export interface Settlement {
  id: string;
  trip_id: string;
  from_user: string; // references trip_users.id
  to_user: string;
  amount: number;
  status: SettlementStatus;
  created_at: string;
  from?: TripUser;
  to?: TripUser;
}

// ─── Engine types ─────────────────────────────────────────────────────────────

export interface Balance {
  user_id: string;
  name: string;
  net: number;
}

export interface Transfer {
  from_user: string;
  from_name: string;
  to_user: string;
  to_name: string;
  amount: number;
}

export interface SplitInput {
  amount: number;
  paid_by: string;
  participants: { user_id: string; weight?: number }[];
}

export interface SplitResult {
  user_id: string;
  share: number;
}
