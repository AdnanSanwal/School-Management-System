/**
 * The web app shows menus from a role list (CAN) or, for the staff roles a school can tune,
 * from the user's server permissions (CAP_PERMISSIONS). With the standard permission sets the
 * two must give the same answer, otherwise a menu would appear or vanish for no reason.
 */
import fs from 'fs';
import path from 'path';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../middleware/rbac';

const source = fs.readFileSync(path.join(__dirname, '../../../../frontend/src/lib/roles.ts'), 'utf8').replace(/\r\n/g, '\n');
const literal = (start: string, end: string): Record<string, string[]> => {
  const from = source.indexOf(start);
  const body = source.slice(from + start.length, source.indexOf(end, from));
  // eslint-disable-next-line no-new-func
  return new Function(`return {${body}};`)();
};
const CAN = literal('export const CAN = {', '} satisfies');
const CAP_PERMISSIONS = literal('const CAP_PERMISSIONS: Partial<Record<Capability, string[]>> = {', '\n};');

describe('web capabilities match the server permissions', () => {
  it('reads both tables from the web source', () => {
    expect(Object.keys(CAN).length).toBeGreaterThan(40);
    expect(Object.keys(CAP_PERMISSIONS).length).toBeGreaterThan(30);
  });

  it('names only real capabilities and real permissions', () => {
    for (const [cap, perms] of Object.entries(CAP_PERMISSIONS)) {
      expect(Object.keys(CAN)).toContain(cap);
      for (const p of perms) expect(PERMISSIONS as readonly string[]).toContain(p);
    }
  });

  it.each(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const)('%s sees the same menus either way', (role) => {
    const differences = Object.entries(CAP_PERMISSIONS)
      .filter(([cap, perms]) => CAN[cap].includes(role) !== perms.some((p) => ROLE_PERMISSIONS[role].has(p as never)))
      .map(([cap]) => cap);
    expect(differences).toEqual([]);
  });
});
