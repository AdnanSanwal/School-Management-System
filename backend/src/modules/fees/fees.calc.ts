import { Prisma } from '@prisma/client';

// Pure fee arithmetic, kept free of I/O so it can be unit-tested.
// All money is Prisma.Decimal (MySQL DECIMAL(12,2)); never use JS floats for sums.

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ZERO = D(0);
const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface ConcessionRule {
  feeHeadId: string | null; // null = applies to every head
  type: 'PERCENT' | 'FIXED';
  value: Prisma.Decimal.Value;
}

export interface LineInput {
  feeHeadId: string;
  amount: Prisma.Decimal.Value;
}

export interface Line {
  feeHeadId: string;
  amount: Prisma.Decimal;
  discount: Prisma.Decimal;
}

/**
 * Applies approved concessions to invoice lines.
 *  - PERCENT on a head: that % off the head (all-heads: % off every line).
 *  - FIXED on a head: that amount off the head.
 *  - FIXED for all heads: taken from lines in order until used up.
 * A line's discount never exceeds its amount.
 */
export function applyConcessions(lines: LineInput[], rules: ConcessionRule[]): Line[] {
  const out: Line[] = lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: D(l.amount), discount: ZERO }));
  const room = (l: Line) => l.amount.minus(l.discount);
  const give = (l: Line, want: Prisma.Decimal) => {
    const take = Prisma.Decimal.min(round2(want), room(l));
    l.discount = l.discount.plus(take);
    return take;
  };

  for (const r of rules) {
    const value = D(r.value);
    const targets = r.feeHeadId ? out.filter((l) => l.feeHeadId === r.feeHeadId) : out;
    if (r.type === 'PERCENT') {
      for (const l of targets) give(l, l.amount.times(value).dividedBy(100));
    } else {
      let left = value;
      for (const l of targets) {
        if (left.lte(0)) break;
        left = left.minus(give(l, left));
      }
    }
  }
  return out;
}

export function totals(lines: Line[]) {
  const gross = lines.reduce((s, l) => s.plus(l.amount), ZERO);
  const discount = lines.reduce((s, l) => s.plus(l.discount), ZERO);
  return { gross, discount, net: gross.minus(discount) };
}

export interface OpenInvoice {
  id: string;
  netAmount: Prisma.Decimal.Value;
  fineAmount?: Prisma.Decimal.Value;
  paidAmount: Prisma.Decimal.Value;
}

export function outstanding(inv: Omit<OpenInvoice, 'id'>) {
  return D(inv.netAmount).plus(inv.fineAmount ?? 0).minus(inv.paidAmount);
}

/**
 * Splits a payment across invoices in the order given (callers pass oldest due first).
 * Throws if the payment is larger than what is owed — the school has no advance/credit ledger yet.
 */
export function allocate(amount: Prisma.Decimal.Value, invoices: OpenInvoice[]) {
  let left = D(amount);
  if (left.lte(0)) throw new RangeError('Payment amount must be positive');
  const owed = invoices.reduce((s, i) => s.plus(outstanding(i)), ZERO);
  if (left.gt(owed)) throw new RangeError(`Payment exceeds the outstanding balance of ${owed.toFixed(2)}`);

  const parts: { invoiceId: string; amount: Prisma.Decimal; settles: boolean }[] = [];
  for (const inv of invoices) {
    if (left.lte(0)) break;
    const due = outstanding(inv);
    if (due.lte(0)) continue;
    const take = Prisma.Decimal.min(due, left);
    parts.push({ invoiceId: inv.id, amount: take, settles: take.eq(due) });
    left = left.minus(take);
  }
  return parts;
}
