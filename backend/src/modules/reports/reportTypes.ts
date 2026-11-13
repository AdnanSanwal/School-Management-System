import { z } from 'zod';
import type { Permission } from '../../middleware/rbac';
import type { TableReport } from '../../utils/tableReport';
import type { JwtPayload } from '../../utils/jwt';
export type ReportTable = Omit<TableReport, 'school' | 'currency'>;
export type ReportBuilder = { perms: Permission[]; schoolWideOnly?: boolean; params: z.ZodTypeAny; options?: string[]; build: (ctx: { user: JwtPayload; q: Record<string, unknown>; school: { name: string; currency: string } }) => Promise<ReportTable> };
