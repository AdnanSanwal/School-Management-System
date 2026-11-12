import { z } from 'zod';
import { patchOf } from '../../utils/http';

// A partial update must only contain what was sent. zod's own `.partial()` keeps
// `.default()` values, which would silently overwrite stored data on every PATCH.
describe('patchOf', () => {
  const body = z.object({
    name: z.string().min(2),
    methods: z.array(z.string()).default([]),
    openingBalance: z.coerce.number().default(0),
    isActive: z.boolean().optional(),
  });

  it('adds nothing that was not sent', () => {
    expect(patchOf(body).strict().parse({ name: 'Cash' })).toEqual({ name: 'Cash' });
    expect(patchOf(body).strict().parse({})).toEqual({});
  });
  it('still validates what was sent', () => {
    expect(patchOf(body).strict().parse({ openingBalance: '25', methods: ['CASH'] })).toEqual({ openingBalance: 25, methods: ['CASH'] });
    expect(() => patchOf(body).strict().parse({ name: 'x' })).toThrow();
    expect(() => patchOf(body).strict().parse({ unknown: 1 })).toThrow();
  });
  it('the full schema keeps its defaults for creating', () => {
    expect(body.parse({ name: 'Cash' })).toEqual({ name: 'Cash', methods: [], openingBalance: 0 });
  });
});
