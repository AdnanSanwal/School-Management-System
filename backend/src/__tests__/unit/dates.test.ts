import { dayInTimezone, periodRange, toDate, toIso, tzOffsetMinutes, zonedDayStart } from '../../utils/dates';

describe('date helpers', () => {
  it('round-trips date-only strings', () => {
    expect(toIso(toDate('2026-11-07'))).toBe('2026-11-07');
    expect(() => toDate('2026-13-45')).toThrow();
  });

  it('knows the school-local day', () => {
    // 21:30 UTC on 6 Nov is already 7 Nov in Karachi (UTC+5)
    expect(dayInTimezone('Asia/Karachi', new Date('2026-11-06T21:30:00Z'))).toBe('2026-11-07');
    expect(dayInTimezone('UTC', new Date('2026-11-06T21:30:00Z'))).toBe('2026-11-06');
  });

  it('computes timezone offsets, including DST zones', () => {
    expect(tzOffsetMinutes('Asia/Karachi', new Date('2026-11-07T00:00:00Z'))).toBe(300);
    expect(tzOffsetMinutes('Europe/London', new Date('2026-07-01T00:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/London', new Date('2026-12-01T00:00:00Z'))).toBe(0);
  });

  it('finds when a local day starts in UTC', () => {
    expect(zonedDayStart('2026-11-07', 'Asia/Karachi').toISOString()).toBe('2026-11-06T19:00:00.000Z');
    expect(zonedDayStart('2026-07-01', 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });

  it('gives month ranges', () => {
    const { start, end } = periodRange('2027-02');
    expect([toIso(start), toIso(end)]).toEqual(['2027-02-01', '2027-02-28']);
  });
});
