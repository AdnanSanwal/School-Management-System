import { Router } from 'express';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { hasPermission } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, me } from '../../utils/http';
import { toIso } from '../../utils/dates';
import { licenceStatus } from '../../utils/licence';

// The school's own view of its subscription. Reachable even when the school is locked,
// so people can see why and until when.

const router = Router();
router.use(authenticate);

router.get('/', handler(async (req, res) => {
  const user = me(req);
  const status = await licenceStatus(currentSchoolId());
  // Payment history and usage are for the people who run the school.
  const full = user.role === 'OWNER' || hasPermission(user.role, 'school.manage');
  if (!full) return sendSuccess(res, { status });
  const [payments, students] = await Promise.all([
    prisma.licencePayment.findMany({ orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: 24 }),
    prisma.student.count({ where: { status: 'ACTIVE' } }),
  ]);
  return sendSuccess(res, {
    status, activeStudents: students,
    payments: payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, paidOn: toIso(p.paidOn), coversUntil: toIso(p.coversUntil), method: p.method, reference: p.reference, note: p.note })),
  });
}));

export default router;
