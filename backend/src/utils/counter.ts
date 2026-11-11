import type { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';

type Tx = Pick<ScopedTx, 'counter'>;

/**
 * Next value of a per-school sequence (receipt, invoice, admission numbers).
 * Call inside the same transaction that uses the number: the upsert's increment
 * takes a row lock, so concurrent callers get distinct values and a rollback
 * gives the number back.
 */
export async function nextNumber(tx: Tx, key: 'receipt' | 'invoice' | 'admission' | 'employee' | 'expense' | 'income' | 'loan' | 'journal'): Promise<number> {
  const schoolId = currentSchoolId();
  const row = await tx.counter.upsert({
    where: { schoolId_key: { schoolId, key } },
    create: { schoolId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export function formatNumber(prefix: string, n: number, width = 5) {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}
