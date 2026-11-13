import { staffLogin } from '../../utils/scope';
import { branchOwners } from '../../utils/branches';
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, id, money, period, me } from '../../utils/http';
import { periodOf, periodRange, schoolToday, toDate, toIso } from '../../utils/dates';
import { formatNumber, nextNumber } from '../../utils/counter';
import { notify } from '../../utils/notify';
import { staffForUser } from '../../utils/scope';
import { assertBooksOpen, assertCanPay, ensureFinanceSetup } from '../../utils/finance';
import { buildLines, lineTotals, monthLabel, outstandingLoans, runTotals } from '../../utils/payroll';
import { toPdf, toXlsx } from '../../utils/tableReport';
import { D } from '../fees/fees.calc';
import { onRoll } from '../../utils/staffStatus';

// Payroll: monthly runs (draft → submitted → approved by the owner → paid), payslips,
// the bank transfer sheet, and staff advances / loans recovered from salary.

const router = Router();
router.use(authenticate);
router.use((req, _res, next) => {
  if (!hasPermission(me(req as never).role, 'payroll.view')) return next();
  ensureFinanceSetup().then(() => next(), next);
});

const positive = money.refine((v) => v > 0, 'must be more than 0');
type Part = { name: string; amount: number };
const parts = (v: Prisma.JsonValue) => (Array.isArray(v) ? (v as unknown as Part[]) : []);

async function runOr404(runId: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId } });
  if (!run) throw new AppError('Payroll not found', 404);
  return run;
}
const draftOnly = (run: { status: string }) => {
  if (run.status !== 'DRAFT') throw new AppError('This payroll is no longer a draft. Reopen it to make changes.', 409);
};

// ─── Runs ───

router.get('/runs', can('payroll.view'), handler(async (_req, res) => {
  const [runs, sums] = await Promise.all([
    prisma.payrollRun.findMany({ orderBy: { period: 'desc' } }),
    prisma.payrollLine.groupBy({ by: ['runId'], _count: true, _sum: { gross: true, net: true, totalDeductions: true } }),
  ]);
  return sendSuccess(res, runs.map((r) => {
    const s = sums.find((x) => x.runId === r.id);
    return {
      ...r, paymentDate: r.paymentDate ? toIso(r.paymentDate) : null, label: monthLabel(r.period),
      staff: s?._count ?? 0, gross: D(s?._sum.gross ?? 0), deductions: D(s?._sum.totalDeductions ?? 0), net: D(s?._sum.net ?? 0),
    };
  }));
}));

router.post('/runs', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ period }), req);
  if (b.period > periodOf(await schoolToday())) throw new AppError('Payroll can’t be prepared for a future month', 422);
  if (await prisma.payrollRun.findFirst({ where: { period: b.period } })) throw new AppError(`Payroll for ${monthLabel(b.period)} already exists`, 409);
  const out = await transaction(async (tx) => {
    const run = await tx.payrollRun.create({ data: { schoolId: currentSchoolId(), period: b.period, createdById: me(req).id } });
    const missing = await buildLines(tx, run);
    if (!(await tx.payrollLine.count({ where: { runId: run.id } }))) {
      throw new AppError('Nobody has a salary set yet. Set salaries on the staff profiles first.', 422);
    }
    return { id: run.id, missing };
  });
  return sendSuccess(res, out, `Payroll for ${monthLabel(b.period)} prepared${out.missing.length ? `; ${out.missing.length} staff have no salary set` : ''}`, 201);
}));

router.get('/runs/:id', can('payroll.view'), handler(async (req, res) => {
  const run = await runOr404(req.params.id);
  const [lines, account, people, active] = await Promise.all([
    prisma.payrollLine.findMany({ where: { runId: run.id }, orderBy: { name: 'asc' } }),
    run.accountId ? prisma.moneyAccount.findFirst({ where: { id: run.accountId }, select: { name: true } }) : null,
    prisma.user.findMany({ where: { id: { in: [run.createdById, run.decidedById, run.paidById].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    run.status === 'DRAFT' ? prisma.staff.findMany({ where: { status: onRoll }, select: { id: true, name: true, employeeNo: true, joiningDate: true } }) : [],
  ]);
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const { end } = periodRange(run.period);
  return sendSuccess(res, {
    ...run, paymentDate: run.paymentDate ? toIso(run.paymentDate) : null, label: monthLabel(run.period),
    account: account?.name ?? null, createdBy: who(run.createdById), decidedBy: who(run.decidedById), paidBy: who(run.paidById),
    totals: runTotals(lines), lines,
    // Active staff left out because no salary is set.
    missing: active.filter((s) => (!s.joiningDate || s.joiningDate <= end) && !lines.some((l) => l.staffId === s.id)).map(({ joiningDate: _j, ...s }) => s),
  });
}));

/** Rebuilds a draft from today's attendance, leave, salaries and loans. `reset` also drops the hand-made changes. */
router.post('/runs/:id/recalculate', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ reset: z.boolean().default(false) }), req);
  const run = await runOr404(req.params.id);
  draftOnly(run);
  const missing = await transaction(async (tx) => {
    if (b.reset) await tx.payrollLine.updateMany({ where: { runId: run.id }, data: { deductDaysManual: false, loanManual: false, bonus: 0, otherDeduction: 0, remarks: null } });
    return buildLines(tx, run);
  });
  return sendSuccess(res, { missing }, b.reset ? 'Recalculated from scratch' : 'Recalculated; your own changes were kept');
}));

/** The accountant's review: change the days deducted, loan recovery, bonus or other deduction. */
router.patch('/lines/:id', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    deductDays: z.number().min(0).max(31).multipleOf(0.5).optional(),
    loanDeduction: money.optional(),
    bonus: money.optional(),
    otherDeduction: money.optional(),
    remarks: z.string().trim().max(300).nullable().optional(),
  }).strict(), req);
  const line = await prisma.payrollLine.findFirst({ where: { id: req.params.id }, include: { run: true } });
  if (!line) throw new AppError('Payroll line not found', 404);
  draftOnly(line.run);
  if (b.deductDays !== undefined && b.deductDays > line.daysInMonth) throw new AppError(`The month has only ${line.daysInMonth} days`, 422);
  if (b.loanDeduction !== undefined) {
    const owed = (await outstandingLoans(prisma, [line.staffId])).reduce((t, l) => t.plus(l.outstanding), D(0));
    if (D(b.loanDeduction).gt(owed)) throw new AppError(`${line.name} owes only ${owed.toFixed(0)} in advances and loans`, 422);
  }
  const next = {
    gross: line.gross, daysInMonth: line.daysInMonth, fixedDeductions: parts(line.fixedDeductions),
    deductDays: b.deductDays ?? line.deductDays, loanDeduction: b.loanDeduction ?? line.loanDeduction,
    bonus: b.bonus ?? line.bonus, otherDeduction: b.otherDeduction ?? line.otherDeduction,
  };
  const t = lineTotals(next);
  if (t.net.lt(0)) throw new AppError(`That leaves ${line.name} with less than nothing (${t.net.toFixed(0)}). Reduce the deductions.`, 422);
  const updated = await prisma.payrollLine.update({
    where: { id: line.id },
    data: {
      deductDays: next.deductDays, loanDeduction: next.loanDeduction, bonus: next.bonus, otherDeduction: next.otherDeduction,
      ...(b.remarks !== undefined ? { remarks: b.remarks || null } : {}),
      ...(b.deductDays !== undefined ? { deductDaysManual: true } : {}),
      ...(b.loanDeduction !== undefined ? { loanManual: true } : {}),
      absenceDeduction: t.absenceDeduction, totalDeductions: t.totalDeductions, net: t.net,
    },
  });
  return sendSuccess(res, updated, 'Saved');
}));

router.post('/runs/:id/submit', can('payroll.manage'), handler(async (req, res) => {
  const run = await runOr404(req.params.id);
  draftOnly(run);
  const lines = await prisma.payrollLine.findMany({ where: { runId: run.id }, select: { name: true, net: true } });
  if (!lines.length) throw new AppError('This payroll has nobody on it', 422);
  const negative = lines.find((l) => l.net.lt(0));
  if (negative) throw new AppError(`${negative.name}'s deductions are more than their pay. Fix that line first.`, 422);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), decidedById: null, decidedAt: null, decisionNote: null } });
  const owners = await branchOwners(currentSchoolId());
  const net = lines.reduce((t, l) => t.plus(l.net), D(0));
  await notify(owners.map((o) => o.id), {
    type: 'PAYROLL_APPROVAL', title: 'Payroll needs your approval',
    body: `${monthLabel(run.period)}: ${lines.length} staff, net ${net.toFixed(0)}`, data: { runId: run.id },
  });
  return sendSuccess(res, null, 'Sent to the owner for approval');
}));

router.post('/runs/:id/decision', can('payroll.approve'), handler(async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }), req);
  const run = await runOr404(req.params.id);
  // Separation of duties (AUTHZ-5): the person who asked for it can't also approve it — except the owner, whose business it is.
  if (run.createdById === me(req).id && me(req).role !== 'OWNER') throw new AppError('You cannot approve a payroll you prepared', 403);
  const { count } = await prisma.payrollRun.updateMany({
    where: { id: run.id, status: 'SUBMITTED' },
    data: { status: b.approve ? 'APPROVED' : 'DRAFT', decidedById: me(req).id, decidedAt: new Date(), decisionNote: b.note || null },
  });
  if (!count) throw new AppError('This payroll is not waiting for approval', 409);
  if (run.createdById) {
    await notify([run.createdById], {
      type: 'PAYROLL_DECIDED', title: b.approve ? 'Payroll approved' : 'Payroll sent back',
      body: `${monthLabel(run.period)}${b.note ? ` — ${b.note}` : ''}`, data: { runId: run.id },
    });
  }
  return sendSuccess(res, null, b.approve ? 'Payroll approved. The accountant can now pay it.' : 'Sent back to the accountant');
}));

/** Back to draft for corrections; it then needs the owner's approval again. */
router.post('/runs/:id/reopen', can('payroll.manage'), handler(async (req, res) => {
  const { count } = await prisma.payrollRun.updateMany({ where: { id: req.params.id, status: { in: ['SUBMITTED', 'APPROVED'] } }, data: { status: 'DRAFT' } });
  if (!count) throw new AppError('Only a payroll that is waiting or approved (and not yet paid) can be reopened', 409);
  return sendSuccess(res, null, 'Reopened as a draft');
}));

/** Pays the approved payroll from one account and recovers the advances / loans on it. */
router.post('/runs/:id/pay', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ accountId: id, paymentDate: dateOnly }), req);
  const run = await runOr404(req.params.id);
  if (run.status !== 'APPROVED') throw new AppError(run.status === 'PAID' ? 'This payroll is already paid' : 'The owner has not approved this payroll yet', 409);
  if (toDate(b.paymentDate) > await schoolToday()) throw new AppError('The payment date can’t be in the future', 422);
  await assertBooksOpen(b.paymentDate);
  const account = await prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } });
  if (!account) throw new AppError('Choose the account to pay from', 422);
  const lines = await prisma.payrollLine.findMany({ where: { runId: run.id }, include: { staff: { select: { userId: true } } } });
  const net = lines.reduce((t, l) => t.plus(l.net), D(0));
  await assertCanPay(account.id, net, `${monthLabel(run.period)} salaries`);

  const user = me(req);
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    const claimed = await tx.payrollRun.updateMany({
      where: { id: run.id, status: 'APPROVED' },
      data: { status: 'PAID', paidById: user.id, paidAt: new Date(), paymentDate: toDate(b.paymentDate), accountId: account.id },
    });
    if (!claimed.count) throw new AppError('This payroll was just paid by someone else', 409);
    if (net.gt(0)) {
      const category = await tx.financeCategory.findFirst({ where: { kind: 'EXPENSE', name: 'Salaries' } })
        ?? await tx.financeCategory.create({ data: { schoolId, kind: 'EXPENSE', name: 'Salaries' } });
      await tx.expense.create({
        data: {
          schoolId, expenseNo: formatNumber('EXP', await nextNumber(tx, 'expense')), categoryId: category.id, accountId: account.id,
          amount: net, expenseDate: toDate(b.paymentDate), description: `Salaries for ${monthLabel(run.period)} (${lines.length} staff)`,
          status: 'APPROVED', requestedById: user.id, decidedById: run.decidedById, decidedAt: new Date(), payrollRunId: run.id,
        },
      });
    }
    // Recover advances and loans, oldest first.
    const owing = lines.filter((l) => l.loanDeduction.gt(0));
    const loans = await outstandingLoans(tx, owing.map((l) => l.staffId));
    for (const line of owing) {
      let left = D(line.loanDeduction);
      for (const loan of loans.filter((l) => l.staffId === line.staffId)) {
        if (left.lte(0)) break;
        const take = Prisma.Decimal.min(left, loan.outstanding);
        if (take.lte(0)) continue;
        await tx.loanRepayment.create({ data: { schoolId, loanId: loan.id, amount: take, paidOn: toDate(b.paymentDate), payrollLineId: line.id, note: `Salary ${monthLabel(run.period)}` } });
        loan.outstanding = loan.outstanding.minus(take);
        left = left.minus(take);
        if (loan.outstanding.lte(0)) await tx.staffLoan.update({ where: { id: loan.id }, data: { status: 'SETTLED' } });
      }
      if (left.gt(0)) throw new AppError(`${line.name} no longer owes the ${D(line.loanDeduction).toFixed(0)} this payroll recovers. Reopen the payroll and recalculate.`, 409);
    }
  });
  await notify((await Promise.all(lines.map(l => staffLogin(l.staffId)))).filter((u): u is NonNullable<typeof u> => !!u).map(u => u.id), {
    type: 'PAYSLIP_READY', title: 'Salary paid', body: `Your payslip for ${monthLabel(run.period)} is ready.`, data: { runId: run.id },
  });
  return sendSuccess(res, null, `Paid ${net.toFixed(0)} from ${account.name}`);
}));

router.delete('/runs/:id', can('payroll.manage'), handler(async (req, res) => {
  const run = await runOr404(req.params.id);
  draftOnly(run);
  await prisma.payrollRun.delete({ where: { id: run.id } });
  return sendSuccess(res, null, 'Draft payroll deleted');
}));

/** What to hand the bank (or the cashier): who gets how much, into which account. */
router.get('/runs/:id/bank-sheet', can('payroll.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ format: z.enum(['xlsx', 'pdf']).default('xlsx') }), req);
  const run = await runOr404(req.params.id);
  const [lines, school] = await Promise.all([
    prisma.payrollLine.findMany({ where: { runId: run.id, net: { gt: 0 } }, orderBy: { name: 'asc' } }),
    prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { name: true, currency: true } }),
  ]);
  const bank = lines.filter((l) => l.bankAccountNo);
  const cash = lines.filter((l) => !l.bankAccountNo);
  const sum = (ls: typeof lines) => ls.reduce((t, l) => t.plus(l.net), D(0));
  const report = {
    title: `Salary transfer sheet — ${monthLabel(run.period)}`, school: school.name, currency: school.currency,
    subtitle: `${bank.length} by bank transfer (${sum(bank).toFixed(0)}), ${cash.length} in cash (${sum(cash).toFixed(0)})${run.status === 'PAID' ? '' : ` · ${run.status.toLowerCase()}, not paid yet`}`,
    columns: [
      { key: 'no', label: '#', width: 5 }, { key: 'employeeNo', label: 'Employee no.', width: 14 }, { key: 'name', label: 'Name', width: 26 },
      { key: 'bank', label: 'Bank', width: 20 }, { key: 'title', label: 'Account title', width: 26 }, { key: 'account', label: 'Account no. / IBAN', width: 30 },
      { key: 'net', label: 'Net pay', type: 'money' as const, width: 16, align: 'right' as const },
    ],
    rows: [...bank, ...cash].map((l, i) => ({
      no: i + 1, employeeNo: l.employeeNo, name: l.name, bank: l.bankAccountNo ? l.bankName ?? '' : 'Cash',
      title: l.bankAccountNo ? l.bankAccountTitle ?? l.name : '', account: l.bankAccountNo ?? '', net: Number(l.net),
    })),
    totals: { name: 'Total', net: Number(sum(lines)) },
  };
  const file = q.format === 'pdf' ? await toPdf(report) : await toXlsx(report);
  res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary-transfer-${run.period}.${q.format}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(file);
}));

// ─── Payslips ───

function payslip(line: Prisma.PayrollLineGetPayload<{ include: { run: true } }>, school: { name: string; currency: string; address?: string | null }) {
  const { run, ...l } = line;
  return {
    school, period: run.period, label: monthLabel(run.period), status: run.status, paymentDate: run.paymentDate ? toIso(run.paymentDate) : null,
    ...l, allowances: parts(l.allowances), fixedDeductions: parts(l.fixedDeductions),
    paidDays: D(l.daysInMonth).minus(l.deductDays),
  };
}

/** One payslip: payroll staff see any, everyone else only their own once it is paid. */
router.get('/lines/:id/payslip', handler(async (req, res) => {
  const user = me(req);
  const line = await prisma.payrollLine.findFirst({ where: { id: req.params.id }, include: { run: true } });
  if (!line) throw new AppError('Payslip not found', 404);
  if (!hasPermission(user.role, 'payroll.view')) {
    const staff = await staffForUser(user.id);
    if (!staff || staff.id !== line.staffId || line.run.status !== 'PAID') throw new AppError('Payslip not found', 404);
  }
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { name: true, currency: true, address: true } });
  return sendSuccess(res, payslip(line, school));
}));

/** My own payslips (paid months) and what I still owe in advances / loans. */
router.get('/my', handler(async (req, res) => {
  const staff = await staffForUser(me(req).id);
  if (!staff) return sendSuccess(res, { staff: null, payslips: [], loans: [] });
  const [lines, loans] = await Promise.all([
    prisma.payrollLine.findMany({ where: { staffId: staff.id, run: { status: 'PAID' } }, include: { run: { select: { period: true, paymentDate: true } } }, orderBy: { run: { period: 'desc' } } }),
    outstandingLoans(prisma, [staff.id]),
  ]);
  return sendSuccess(res, {
    staff: { id: staff.id, name: staff.name, employeeNo: staff.employeeNo },
    payslips: lines.map((l) => ({
      id: l.id, period: l.run.period, label: monthLabel(l.run.period), paymentDate: l.run.paymentDate ? toIso(l.run.paymentDate) : null,
      gross: l.gross, bonus: l.bonus, totalDeductions: l.totalDeductions, net: l.net,
    })),
    loans: loans.map((l) => ({ id: l.id, loanNo: l.loanNo, kind: l.kind, amount: l.amount, installment: l.installment, issuedOn: toIso(l.issuedOn), outstanding: l.outstanding })),
  });
}));

// ─── Advances and loans ───

/** What unpaid payrolls already plan to recover from this person. */
async function plannedRecovery(staffId: string) {
  const r = await prisma.payrollLine.aggregate({ where: { staffId, run: { status: { not: 'PAID' } } }, _sum: { loanDeduction: true } });
  return D(r._sum.loanDeduction ?? 0);
}
async function assertStillCovers(staffId: string, reduceBy: Prisma.Decimal.Value) {
  const planned = await plannedRecovery(staffId);
  if (planned.lte(0)) return;
  const owed = (await outstandingLoans(prisma, [staffId])).reduce((t, l) => t.plus(l.outstanding), D(0));
  if (owed.minus(reduceBy).lt(planned)) {
    throw new AppError(`A payroll that is not paid yet already recovers ${planned.toFixed(0)} from this person. Recalculate that payroll first.`, 409);
  }
}

router.get('/loans', can('payroll.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum(['ACTIVE', 'SETTLED']).optional(), staffId: id.optional() }), req);
  const loans = await prisma.staffLoan.findMany({
    where: { ...(q.status ? { status: q.status } : {}), ...(q.staffId ? { staffId: q.staffId } : {}) },
    include: {
      staff: { select: { id: true, name: true, employeeNo: true, designation: true } },
      account: { select: { name: true } },
      repayments: { orderBy: { paidOn: 'asc' }, include: { account: { select: { name: true } } } },
    },
    orderBy: [{ status: 'asc' }, { issuedOn: 'desc' }, { createdAt: 'desc' }],
  });
  const rows = loans.map((l) => {
    const repaid = l.repayments.reduce((t, r) => t.plus(r.amount), D(0));
    return {
      ...l, issuedOn: toIso(l.issuedOn), repaid, outstanding: D(l.amount).minus(repaid),
      repayments: l.repayments.map((r) => ({ id: r.id, amount: r.amount, paidOn: toIso(r.paidOn), note: r.note, fromSalary: !!r.payrollLineId, account: r.account?.name ?? null })),
    };
  });
  return sendSuccess(res, {
    loans: rows,
    totals: { outstanding: rows.reduce((t, l) => t.plus(l.outstanding), D(0)), active: rows.filter((l) => l.status === 'ACTIVE').length },
  });
}));

router.post('/loans', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    staffId: id, kind: z.enum(['ADVANCE', 'LOAN']), amount: positive, issuedOn: dateOnly, accountId: id,
    installment: positive.optional(), startPeriod: period.optional(), note: z.string().trim().max(300).optional(),
  }), req);
  const [staff, account] = await Promise.all([
    prisma.staff.findFirst({ where: { id: b.staffId, status: onRoll } }),
    prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } }),
  ]);
  if (!staff) throw new AppError('Choose an active staff member', 422);
  if (!account) throw new AppError('Choose the account it is paid from', 422);
  if (toDate(b.issuedOn) > await schoolToday()) throw new AppError('The date can’t be in the future', 422);
  await assertBooksOpen(b.issuedOn);
  // An advance comes back in one go; a loan in the instalments given.
  const installment = b.kind === 'ADVANCE' ? b.installment ?? b.amount : b.installment;
  if (!installment) throw new AppError('Enter the monthly instalment', 422);
  if (installment > b.amount) throw new AppError('The instalment can’t be more than the amount', 422);
  const startPeriod = b.startPeriod ?? b.issuedOn.slice(0, 7);
  if (startPeriod < b.issuedOn.slice(0, 7)) throw new AppError('Recovery can’t start before the money is given', 422);
  await assertCanPay(account.id, b.amount, 'this');
  const loan = await transaction(async (tx) => tx.staffLoan.create({
    data: {
      schoolId: currentSchoolId(), loanNo: formatNumber(b.kind === 'ADVANCE' ? 'ADV' : 'LN', await nextNumber(tx, 'loan')), staffId: staff.id, kind: b.kind,
      amount: b.amount, issuedOn: toDate(b.issuedOn), accountId: account.id, installment, startPeriod, note: b.note || null, createdById: me(req).id,
    },
  }));
  return sendSuccess(res, loan, `${loan.loanNo}: ${D(b.amount).toFixed(0)} given to ${staff.name} from ${account.name}`, 201);
}));

/** Money paid back by hand (not through salary), into an account. */
router.post('/loans/:id/repayments', can('payroll.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ amount: positive, paidOn: dateOnly, accountId: id, note: z.string().trim().max(300).optional() }), req);
  const loan = (await outstandingLoans(prisma)).find((l) => l.id === req.params.id);
  if (!loan) throw new AppError('This advance or loan is not open', 404);
  if (D(b.amount).gt(loan.outstanding)) throw new AppError(`Only ${loan.outstanding.toFixed(0)} is still owed`, 422);
  if (toDate(b.paidOn) > await schoolToday()) throw new AppError('The date can’t be in the future', 422);
  if (toDate(b.paidOn) < loan.issuedOn) throw new AppError('It can’t be paid back before it was given', 422);
  await assertBooksOpen(b.paidOn);
  const account = await prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } });
  if (!account) throw new AppError('Choose the account that received it', 422);
  await assertStillCovers(loan.staffId, b.amount);
  await transaction(async (tx) => {
    await tx.loanRepayment.create({ data: { schoolId: currentSchoolId(), loanId: loan.id, amount: b.amount, paidOn: toDate(b.paidOn), accountId: account.id, note: b.note || null } });
    if (loan.outstanding.minus(b.amount).lte(0)) await tx.staffLoan.update({ where: { id: loan.id }, data: { status: 'SETTLED' } });
  });
  return sendSuccess(res, null, loan.outstanding.minus(b.amount).lte(0) ? `${loan.loanNo} is fully paid back` : 'Repayment recorded', 201);
}));

/** Entered by mistake: allowed only while nothing has been paid back. */
router.delete('/loans/:id', can('payroll.manage'), handler(async (req, res) => {
  const loan = await prisma.staffLoan.findFirst({ where: { id: req.params.id }, include: { _count: { select: { repayments: true } } } });
  if (!loan) throw new AppError('Not found', 404);
  if (loan._count.repayments) throw new AppError('Part of this has already been paid back, so it can’t be deleted', 409);
  await assertBooksOpen(loan.issuedOn);
  await assertStillCovers(loan.staffId, loan.amount);
  await prisma.staffLoan.delete({ where: { id: loan.id } });
  return sendSuccess(res, null, `${loan.loanNo} deleted; ${D(loan.amount).toFixed(0)} is back in the account`);
}));

export default router;
