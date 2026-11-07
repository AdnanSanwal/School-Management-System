import { Router } from 'express';
import prisma from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, me } from '../../utils/http';
import { toIso } from '../../utils/dates';
import { signedUrl } from '../../utils/storage';

// One inbox for everything waiting on a decision (spec §6 Principal → Approvals).
// Each section is included only if the viewer may decide it.

const router = Router();
router.use(authenticate);

router.get('/', can('leave.approve', 'fee.concession.approve', 'fee.collect'), handler(async (req, res) => {
  const role = me(req).role;
  const [leaves, concessions, claims] = await Promise.all([
    hasPermission(role, 'leave.approve')
      ? prisma.leaveRequest.findMany({
          where: { status: 'PENDING' }, orderBy: { fromDate: 'asc' },
          include: { staff: { select: { name: true, designation: true } } },
        })
      : null,
    hasPermission(role, 'fee.concession.approve')
      ? prisma.concession.findMany({
          where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
          include: { student: { select: { id: true, name: true, admissionNo: true } }, feeHead: { select: { name: true } } },
        })
      : null,
    hasPermission(role, 'fee.collect')
      ? prisma.paymentClaim.findMany({
          where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
          include: { student: { select: { id: true, name: true, admissionNo: true } } },
        })
      : null,
  ]);
  return sendSuccess(res, {
    total: (leaves?.length ?? 0) + (concessions?.length ?? 0) + (claims?.length ?? 0),
    leaves: leaves?.map((l) => ({ ...l, fromDate: toIso(l.fromDate), toDate: toIso(l.toDate) })) ?? null,
    concessions,
    paymentClaims: claims?.map(({ proofKey, ...c }) => ({ ...c, proof: signedUrl(proofKey) })) ?? null,
  });
}));

export default router;
