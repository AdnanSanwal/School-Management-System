import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { handler, parseBody, id, money, dateOnly, period, me } from '../../utils/http';
import { sendSuccess } from '../../utils/apiResponse';
import { schoolToday, toDate } from '../../utils/dates';
import { assertBooksOpen, assertCanPay } from '../../utils/finance';
import { nextNumber, formatNumber } from '../../utils/counter';
import { onRoll } from '../../utils/staffStatus';
import { audit } from '../../utils/audit';
import { branchOwners } from '../../utils/branches';
import { notify } from '../../utils/notify';
import { permissionsFor } from '../../utils/rolePermissions';

const router = Router();
export const loanInput = z.object({ staffId: id, kind: z.enum(['ADVANCE', 'LOAN']), amount: money.positive(), issuedOn: dateOnly, accountId: id, installment: money.positive().optional(), startPeriod: period.optional(), recoveryMethod: z.enum(['SALARY','MANUAL']).default('SALARY'), note: z.string().trim().max(300).optional() });

export async function validateLoan(b: z.infer<typeof loanInput>) {
  const [staff, account] = await Promise.all([prisma.staff.findFirst({ where: { id: b.staffId, status: onRoll } }), prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } })]);
  if (!staff || !account) throw new AppError('Choose an active staff member and account in this branch', 422);
  const issued = toDate(b.issuedOn);
  if (issued.toISOString().slice(0, 10) !== b.issuedOn || issued > await schoolToday()) throw new AppError('Choose a valid date, not in the future', 422);
  const installment = b.recoveryMethod==='MANUAL'?b.amount:b.installment ?? (b.kind === 'ADVANCE' ? b.amount : 0);
  if (!installment || installment > b.amount) throw new AppError('Enter a monthly installment greater than zero and no more than the amount', 422);
  if ((b.startPeriod ?? b.issuedOn.slice(0, 7)) < b.issuedOn.slice(0, 7)) throw new AppError('Recovery cannot start before disbursement', 422);
  return { ...b, installment, startPeriod: b.startPeriod ?? b.issuedOn.slice(0, 7) };
}

router.get('/', can('payroll.view', 'loan.approve'), handler(async (_req, res) => {
  const rows = await prisma.loanRequest.findMany({ orderBy: { createdAt: 'desc' } });
  const staff = await prisma.staff.findMany({ where: { id: { in: rows.map(r => (r.payload as any).staffId) } }, select: { id: true, name: true, employeeNo: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.flatMap(r => [r.requestedById, r.decidedById].filter(Boolean) as string[]) } }, select: { id: true, name: true } });
  return sendSuccess(res, rows.map(r => ({ ...r, details: r.payload, staff: staff.find(s => s.id === (r.payload as any).staffId), requestedBy: users.find(u => u.id === r.requestedById)?.name, decidedBy: users.find(u => u.id === r.decidedById)?.name })));
}));

router.post('/', can('payroll.manage'), handler(async (req, res) => {
  const details = await validateLoan(parseBody(loanInput.extend({note:z.string().trim().min(3).max(300)}), req));
  const row = await prisma.loanRequest.create({ data: { schoolId: currentSchoolId(), payload: details as Prisma.InputJsonValue, requestedById: me(req).id } });
  await audit(req, { action: 'Advance / loan requested', entity: 'loan-requests', entityId: row.id, meta: { amount: details.amount, kind: details.kind, staffId: details.staffId } });
  const candidates=await prisma.user.findMany({where:{isActive:true,role:{in:['PRINCIPAL','ADMIN','ACCOUNTANT']}},select:{id:true,role:true}});
  const delegated=await Promise.all(candidates.map(async u=>(await permissionsFor(u.role,currentSchoolId(),u.id)).includes('loan.approve')?u.id:null));
  await notify([...new Set([...(await branchOwners(currentSchoolId())).map(u=>u.id),...delegated.filter((v):v is string=>!!v)])], { type: 'PAYROLL_APPROVAL', title: 'Advance / loan approval requested', body: `${details.kind}: ${details.amount}`, data: { url: '/payroll/loans' } });
  return sendSuccess(res, row, 'Request submitted for approval. No money has been deducted.', 201);
}));

router.post('/:id/decision', can('loan.approve'), handler(async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }), req);
  const row = await prisma.loanRequest.findFirst({ where: { id: req.params.id } });
  if (!row) throw new AppError('Request not found', 404);
  if (row.requestedById === me(req).id && me(req).role !== 'OWNER') throw new AppError('Another approver must review your own request', 403);
  const result = await prisma.loanRequest.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: b.approve ? 'APPROVED' : 'REJECTED', decidedById: me(req).id, decidedAt: new Date(), decisionNote: b.note || null } });
  if (!result.count) throw new AppError('This request has already been decided', 409);
  await audit(req, { action: b.approve ? 'Advance / loan approved' : 'Advance / loan rejected', entity: 'loan-requests', entityId: row.id, meta: { note: b.note ?? null } });
  return sendSuccess(res, null, b.approve ? 'Approved. The accountant can record disbursement.' : 'Request rejected');
}));

router.post('/:id/disburse', can('payroll.manage'), handler(async (req, res) => {
  const row = await prisma.loanRequest.findFirst({ where: { id: req.params.id } });
  if (!row) throw new AppError('Request not found', 404);
  if (row.status !== 'APPROVED' || row.loanId) throw new AppError('Only an approved, unpaid request can be disbursed', 409);
  const payment=parseBody(z.object({paymentDate:dateOnly.optional()}),req);
  const approved=loanInput.parse(row.payload);
  const issuedOn=payment.paymentDate??approved.issuedOn;
  const b = await validateLoan({...approved,issuedOn,startPeriod:(approved.startPeriod??approved.issuedOn.slice(0,7))<issuedOn.slice(0,7)?issuedOn.slice(0,7):approved.startPeriod});
  await assertBooksOpen(b.issuedOn);
  const loan = await transaction(async tx => {
    // Lock the account before checking funds; competing requests serialize on this row.
    await tx.moneyAccount.update({ where: { id: b.accountId, isActive: true }, data: { isActive: true } });
    await assertCanPay(b.accountId, b.amount, 'this approved advance / loan');
    const changed = await tx.loanRequest.updateMany({ where: { id: row.id, status: 'APPROVED', loanId: null }, data: { status: 'DISBURSED' } });
    if (!changed.count) throw new AppError('This request has already been paid', 409);
    const loan = await tx.staffLoan.create({ data: { ...b, issuedOn: toDate(b.issuedOn), schoolId: currentSchoolId(), loanNo: formatNumber(b.kind === 'ADVANCE' ? 'ADV' : 'LN', await nextNumber(tx, 'loan')), createdById: me(req).id } });
    await tx.loanRequest.update({ where: { id: row.id }, data: { loanId: loan.id } });
    return loan;
  });
  await audit(req, { action: 'Approved advance / loan disbursed', entity: 'loan-requests', entityId: row.id, meta: { loanId: loan.id, approvedById: row.decidedById, paymentDate:b.issuedOn } });
  return sendSuccess(res, loan, 'Disbursement recorded; salary recovery is now active', 201);
}));

export default router;
