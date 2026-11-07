import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { Prisma, PaymentMethod } from '@prisma/client';
import prisma, { basePrisma } from '../../config/database';
import { currentSchoolId, runWithTenant } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, id, money, me } from '../../utils/http';
import { assertStudentAccess, isSchoolWide, studentScope } from '../../utils/scope';
import { assertKind, deleteFile, saveFile, signedUrl } from '../../utils/storage';
import { guardiansOf, notify, notifyEach } from '../../utils/notify';
import { uploadOne } from '../files/files.routes';
import { collectPayment } from '../fees/fees.service';
import { D, outstanding } from '../fees/fees.calc';
import { activeGateway, testGatewaySign } from './gateways';
import logger from '../../utils/logger';

// Paying fees from the parent app (spec §9 Online Payments, §10 "Pay Online").
//  1. Proof: parent pays into a school account, submits transaction id + screenshot,
//     the accountant verifies → receipt.
//  2. Gateway: checkout on a payment gateway, confirmed by the gateway's callback → receipt.

const router = Router();

const CLAIM_METHODS = ['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'] as const;

/** Open invoices of a student, validated; returns them oldest first with the amount owed. */
async function openInvoices(studentId: string, invoiceIds: string[]) {
  const invoices = await prisma.feeInvoice.findMany({
    where: { id: { in: invoiceIds }, studentId, status: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: { dueDate: 'asc' },
  });
  if (invoices.length !== new Set(invoiceIds).size) throw new AppError('Some selected months are already paid or not this student\'s', 422);
  return { invoices, owed: invoices.reduce((s, i) => s.plus(outstanding(i)), D(0)) };
}

const asIds = z.union([z.array(id), z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))]).pipe(z.array(id).min(1).max(24));

// ─── Public gateway endpoints (no bearer token; verified by signature) ───

router.get('/gateway/test/checkout/:intentId', handler(async (req, res) => {
  const intentId = req.params.intentId;
  if (req.query.sig !== testGatewaySign(intentId, 'view') || activeGateway()?.name !== 'test') throw new AppError('Not found', 404);
  const intent = await basePrisma.paymentIntent.findUnique({ where: { id: intentId }, include: { student: { select: { name: true } } } });
  if (!intent) throw new AppError('Not found', 404);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const form = (result: string, label: string, color: string) => `
    <form method="post" action="/api/v1/payments/gateway/test/callback">
      <input type="hidden" name="intentId" value="${esc(intentId)}"><input type="hidden" name="result" value="${result}">
      <input type="hidden" name="sig" value="${testGatewaySign(intentId, result)}">
      <button style="width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:700;color:#fff;background:${color}">${label}</button>
    </form>`;
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title></head>
  <body style="font-family:system-ui;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:380px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px #0001">
      <p style="color:#b45309;font-size:13px;margin:0 0 12px">⚠️ Test gateway — no real money moves</p>
      <h2 style="margin:0">Pay school fee</h2>
      <p style="color:#6b7280">${esc(intent.student.name)}</p>
      <p style="font-size:32px;font-weight:800;margin:8px 0 20px">PKR ${esc(D(intent.amount).toFixed(2))}</p>
      ${intent.status === 'CREATED' ? `${form('paid', 'Pay', '#4f46e5')}<div style="height:10px"></div>${form('cancelled', 'Cancel', '#9ca3af')}` : `<p>This payment is already ${esc(intent.status.toLowerCase())}.</p>`}
    </div></body></html>`);
}));

/**
 * Gateway callback. Verifies the signature, then records the payment once
 * (the CREATED → SUCCEEDED transition is the idempotency lock).
 */
router.post('/gateway/:provider/callback', express.urlencoded({ extended: false }), handler(async (req, res) => {
  const gw = activeGateway();
  if (!gw || gw.name !== req.params.provider) throw new AppError('Not found', 404);
  const cb = await gw.parseCallback(req);
  if (!cb) throw new AppError('Invalid gateway signature', 400);
  const intent = await basePrisma.paymentIntent.findUnique({ where: { id: cb.intentId } });
  if (!intent) throw new AppError('Unknown payment', 404);

  const outcome = await runWithTenant(intent.schoolId, () => completeIntent(intent.id, cb));
  const ok = outcome === 'SUCCEEDED';
  res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title></head>
    <body style="font-family:system-ui;text-align:center;padding:48px 24px">
      <div style="font-size:48px">${ok ? '✅' : '⚠️'}</div>
      <h2>${ok ? 'Payment received' : outcome === 'FAILED' ? 'Payment not completed' : 'Payment already processed'}</h2>
      <p style="color:#6b7280">You can close this window and return to the school app.</p></body></html>`);
}));

async function completeIntent(intentId: string, cb: { success: boolean; providerRef: string | null; error?: string }) {
  if (!cb.success) {
    const { count } = await prisma.paymentIntent.updateMany({ where: { id: intentId, status: 'CREATED' }, data: { status: 'FAILED', error: cb.error ?? 'Failed' } });
    return count ? 'FAILED' : 'DUPLICATE';
  }
  // Claim the transition first so a repeated callback can't record the payment twice.
  const { count } = await prisma.paymentIntent.updateMany({
    where: { id: intentId, status: 'CREATED' }, data: { status: 'SUCCEEDED', providerRef: cb.providerRef },
  });
  if (!count) return 'DUPLICATE';
  const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
  try {
    const result = await collectPayment({
      studentId: intent.studentId, amount: Number(intent.amount), method: 'ONLINE',
      reference: cb.providerRef ?? intent.id, remarks: `Online payment (${intent.provider})`,
      invoiceIds: intent.invoiceIds as string[],
    });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { paymentId: result.payment.id } });
    const parents = await guardiansOf([intent.studentId]);
    await notifyEach(parents.map((p) => ({
      userId: p.userId, type: 'FEE_PAID' as const, title: 'Online payment received',
      body: `${D(intent.amount).toFixed(2)} paid for ${p.studentName}. Receipt ${result.payment.receiptNo}.`,
      data: { paymentId: result.payment.id, studentId: intent.studentId },
    })));
    return 'SUCCEEDED';
  } catch (err) {
    // Money was taken but the invoices changed meanwhile (e.g. paid at the counter): flag for the office.
    logger.error('Online payment could not be applied', { intentId, message: (err as Error).message });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { error: `Paid but not applied: ${(err as Error).message}` } });
    return 'SUCCEEDED';
  }
}

// ─── Everything below needs a signed-in user ───
router.use(authenticate);

router.get('/options', can('fee.pay', 'fee.view'), handler(async (_req, res) => {
  const gw = activeGateway();
  const accounts = await prisma.paymentAccount.findMany({ where: { isActive: true }, orderBy: { method: 'asc' } });
  return sendSuccess(res, { gateway: gw ? { name: gw.name, label: gw.label } : null, accounts });
}));

// School accounts parents pay into (office manages).
const accountBody = z.object({
  method: z.enum(CLAIM_METHODS),
  title: z.string().min(2).max(100),
  accountNo: z.string().min(4).max(40),
  bankName: z.string().max(80).optional().nullable(),
  iban: z.string().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
});

router.post('/accounts', can('fee.structure.manage'), handler(async (req, res) => {
  const b = parseBody(accountBody, req);
  return sendSuccess(res, await prisma.paymentAccount.create({ data: { schoolId: currentSchoolId(), ...b } }), 'Account added', 201);
}));

router.patch('/accounts/:id', can('fee.structure.manage'), handler(async (req, res) => {
  const b = parseBody(accountBody.partial().strict(), req);
  return sendSuccess(res, await prisma.paymentAccount.update({ where: { id: req.params.id }, data: b }), 'Account updated');
}));

router.delete('/accounts/:id', can('fee.structure.manage'), handler(async (req, res) => {
  const { count } = await prisma.paymentAccount.deleteMany({ where: { id: req.params.id } });
  if (!count) throw new AppError('Account not found', 404);
  return sendSuccess(res, null, 'Account removed');
}));

// ─── 1. Payment proof ───

router.post('/claims', can('fee.pay'), uploadOne, handler(async (req, res) => {
  const b = parseBody(z.object({
    studentId: id,
    invoiceIds: asIds,
    amount: money.refine((v) => v > 0, 'must be positive'),
    method: z.enum(CLAIM_METHODS),
    reference: z.string().trim().min(4).max(60),
    note: z.string().max(300).optional(),
  }), req);
  await assertStudentAccess(me(req), b.studentId);
  const { owed } = await openInvoices(b.studentId, b.invoiceIds);
  if (D(b.amount).gt(owed)) throw new AppError(`Amount is more than the ${owed.toFixed(2)} due for the selected months`, 422);
  const dup = await prisma.paymentClaim.findFirst({ where: { method: b.method, reference: b.reference } });
  if (dup) throw new AppError('This transaction ID was already submitted', 409);

  const proofKey = req.file ? await saveFile(currentSchoolId(), 'documents', req.file.buffer, assertKind(req.file.buffer, ['jpg', 'png', 'webp', 'pdf'])) : null;
  try {
    const claim = await prisma.paymentClaim.create({
      data: {
        schoolId: currentSchoolId(), studentId: b.studentId, invoiceIds: b.invoiceIds, amount: b.amount, method: b.method,
        reference: b.reference, note: b.note ?? null, proofKey, submittedById: me(req).id,
      },
      include: { student: { select: { name: true } } },
    });
    const staff = await prisma.user.findMany({ where: { role: { in: ['ACCOUNTANT', 'ADMIN'] }, isActive: true }, select: { id: true } });
    await notify(staff.map((u) => u.id), {
      type: 'PAYMENT_CLAIM', title: `Fee payment to verify: ${claim.student.name}`,
      body: `${b.method.replace('_', ' ').toLowerCase()} ${D(b.amount).toFixed(2)}, ref ${b.reference}`, data: { claimId: claim.id },
    });
    return sendSuccess(res, claim, 'Sent to the school office for verification', 201);
  } catch (e) {
    await deleteFile(proofKey);
    throw e;
  }
}));

router.get('/claims', can('fee.pay', 'fee.collect'), handler(async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), studentId: id.optional() }), req);
  const user = me(req);
  const where: Prisma.PaymentClaimWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(isSchoolWide(user) ? {} : { student: await studentScope(user) }),
  };
  const rows = await prisma.paymentClaim.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 100,
    include: { student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
  });
  const invoiceIds = [...new Set(rows.flatMap((r) => r.invoiceIds as string[]))];
  const invoices = await prisma.feeInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, period: true } });
  return sendSuccess(res, rows.map(({ proofKey, ...c }) => ({
    ...c, proof: signedUrl(proofKey),
    periods: (c.invoiceIds as string[]).map((i) => invoices.find((x) => x.id === i)?.period).filter(Boolean),
  })));
}));

router.post('/claims/:id/decision', can('fee.collect'), handler(async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req);
  const user = me(req);
  const claim = await prisma.paymentClaim.findFirst({ where: { id: req.params.id } });
  if (!claim) throw new AppError('Claim not found', 404);
  // Lock the claim first so two accountants can't both approve it.
  const { count } = await prisma.paymentClaim.updateMany({
    where: { id: claim.id, status: 'PENDING' },
    data: { status: b.approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: b.note ?? null },
  });
  if (!count) throw new AppError('This claim was already decided', 409);

  const parents = await guardiansOf([claim.studentId]);
  if (!b.approve) {
    await notifyEach(parents.map((p) => ({
      userId: p.userId, type: 'FEE_PAID' as const, title: 'Payment could not be verified',
      body: `Ref ${claim.reference} for ${p.studentName} was not accepted${b.note ? `: ${b.note}` : ''}. Please contact the school office.`,
      data: { studentId: claim.studentId },
    })));
    return sendSuccess(res, null, 'Claim rejected — parent notified');
  }

  try {
    const result = await collectPayment({
      studentId: claim.studentId, amount: Number(claim.amount), method: claim.method as PaymentMethod,
      reference: claim.reference, remarks: 'Verified from parent payment proof', invoiceIds: claim.invoiceIds as string[], collectedById: user.id,
    });
    await prisma.paymentClaim.update({ where: { id: claim.id }, data: { paymentId: result.payment.id } });
    await notifyEach(parents.map((p) => ({
      userId: p.userId, type: 'FEE_PAID' as const, title: 'Payment verified',
      body: `${D(claim.amount).toFixed(2)} received for ${p.studentName}. Receipt ${result.payment.receiptNo}.`,
      data: { paymentId: result.payment.id, studentId: claim.studentId },
    })));
    return sendSuccess(res, { receiptNo: result.payment.receiptNo, paymentId: result.payment.id }, `Verified — receipt ${result.payment.receiptNo}`);
  } catch (err) {
    // Couldn't apply (e.g. months already paid at the counter): put it back for review.
    await prisma.paymentClaim.update({ where: { id: claim.id }, data: { status: 'PENDING', decidedById: null, decidedAt: null } });
    throw err;
  }
}));

// ─── 2. Gateway checkout ───

router.post('/intents', can('fee.pay'), handler(async (req, res) => {
  const gw = activeGateway();
  if (!gw) throw new AppError('Online payment is not available yet', 503);
  const b = parseBody(z.object({ studentId: id, invoiceIds: asIds }), req);
  await assertStudentAccess(me(req), b.studentId);
  const { owed } = await openInvoices(b.studentId, b.invoiceIds);
  if (owed.lte(0)) throw new AppError('Nothing to pay', 422);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { currency: true, name: true } });
  const intent = await prisma.paymentIntent.create({
    data: { schoolId: currentSchoolId(), studentId: b.studentId, invoiceIds: b.invoiceIds, amount: owed, provider: gw.name, createdById: me(req).id },
  });
  const { checkoutUrl } = await gw.createCheckout({
    intentId: intent.id, amount: owed.toFixed(2), currency: school.currency, description: `${school.name} fee`,
    returnUrl: `${(process.env.BACKEND_URL || '').replace(/\/$/, '')}/api/v1/payments/gateway/${gw.name}/callback`,
  });
  return sendSuccess(res, { intentId: intent.id, amount: owed, checkoutUrl }, 'Checkout created', 201);
}));

router.get('/intents/:id', can('fee.pay', 'fee.view'), handler(async (req, res) => {
  const intent = await prisma.paymentIntent.findFirst({ where: { id: req.params.id } });
  if (!intent) throw new AppError('Payment not found', 404);
  if (!hasPermission(me(req).role, 'fee.collect')) await assertStudentAccess(me(req), intent.studentId);
  return sendSuccess(res, intent);
}));

export default router;
