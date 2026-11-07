import { allocate, applyConcessions, totals, D } from '../../modules/fees/fees.calc';

const lines = [
  { feeHeadId: 'tuition', amount: 4000 },
  { feeHeadId: 'lab', amount: 500 },
];

const s = (d: { toFixed(n: number): string }) => d.toFixed(2);

describe('applyConcessions', () => {
  it('no concessions → no discount', () => {
    const t = totals(applyConcessions(lines, []));
    expect([s(t.gross), s(t.discount), s(t.net)]).toEqual(['4500.00', '0.00', '4500.00']);
  });

  it('percent on one head', () => {
    const out = applyConcessions(lines, [{ feeHeadId: 'tuition', type: 'PERCENT', value: 25 }]);
    expect(s(out[0].discount)).toBe('1000.00');
    expect(s(out[1].discount)).toBe('0.00');
  });

  it('percent on all heads', () => {
    expect(s(totals(applyConcessions(lines, [{ feeHeadId: null, type: 'PERCENT', value: 10 }])).discount)).toBe('450.00');
  });

  it('fixed on a head is capped at the head amount', () => {
    const out = applyConcessions(lines, [{ feeHeadId: 'lab', type: 'FIXED', value: 800 }]);
    expect(s(out[1].discount)).toBe('500.00');
    expect(s(out[0].discount)).toBe('0.00');
  });

  it('fixed for all heads spills over lines in order', () => {
    const out = applyConcessions(lines, [{ feeHeadId: null, type: 'FIXED', value: 4200 }]);
    expect(out.map((l) => s(l.discount))).toEqual(['4000.00', '200.00']);
  });

  it('stacked concessions never make a line negative', () => {
    const out = applyConcessions(lines, [
      { feeHeadId: 'tuition', type: 'PERCENT', value: 80 },
      { feeHeadId: 'tuition', type: 'FIXED', value: 2000 },
    ]);
    expect(s(out[0].discount)).toBe('4000.00');
    expect(s(totals(out).net)).toBe('500.00');
  });

  it('rounds percentage discounts to paisa, half up', () => {
    const out = applyConcessions([{ feeHeadId: 'x', amount: 1000.05 }], [{ feeHeadId: 'x', type: 'PERCENT', value: 50 }]);
    expect(s(out[0].discount)).toBe('500.03');
  });
});

describe('allocate', () => {
  const invoices = [
    { id: 'oct', netAmount: 3000, paidAmount: 1000 },
    { id: 'nov', netAmount: 3000, paidAmount: 0 },
    { id: 'dec', netAmount: 3000, paidAmount: 0, fineAmount: 100 },
  ];

  it('settles oldest first and marks partials', () => {
    const parts = allocate(4500, invoices);
    expect(parts.map((p) => [p.invoiceId, s(p.amount), p.settles])).toEqual([
      ['oct', '2000.00', true],
      ['nov', '2500.00', false],
    ]);
  });

  it('includes fines in what is owed', () => {
    const parts = allocate(8100, invoices);
    expect(parts.at(-1)).toMatchObject({ invoiceId: 'dec', settles: true });
    expect(s(parts.at(-1)!.amount)).toBe('3100.00');
  });

  it('rejects overpayment and non-positive amounts', () => {
    expect(() => allocate(8100.01, invoices)).toThrow(/exceeds/);
    expect(() => allocate(0, invoices)).toThrow();
  });

  it('works with decimal inputs without float drift', () => {
    const parts = allocate(D('0.3'), [{ id: 'a', netAmount: '0.1', paidAmount: 0 }, { id: 'b', netAmount: '0.2', paidAmount: 0 }]);
    expect(parts.every((p) => p.settles)).toBe(true);
  });
});
