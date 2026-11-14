# School workflow and dashboard changes

Implemented against the 14 November 2026 change requirements and the user's clarifications. Configurable branding and branch scoping remain in place; the existing Expense Report is retained.

## Where to find the changes

| Area | Result |
| --- | --- |
| Students → profile | Edit profile dialog for name, admission/roll numbers, gender, dates, blood group and address. Uses `student.manage`; class/status/fees keep their existing dedicated actions. Profile changes are audited. |
| New admission → existing parent lookup | Phone and CNIC searches normalize spaces, punctuation and local/international Pakistan phone prefixes. Existing guardians are reused when linking siblings; duplicate selection is blocked. SQL values are parameter-bound and explicitly branch-scoped. |
| Payroll | Monthly summary cards, generation/review controls, workflow strip, staff salary breakdown and status filters. Payment remains one action for the entire approved run. No individual salary payment flow was added. |
| Payroll → run → payment | Record source account, actual date, transaction reference and remarks. References/remarks are stored with the linked salary expense; the run exposes the payment reference. Payslips and salary transfer sheets remain available through the run. |
| Classes → Promote students | Opens the shared promotion workspace inside a dialog. Academic-year selection, class/section mapping, individual exclusions, repeating/graduating/leaving decisions and final confirmation retain the existing implementation. The dedicated promotion page still works. |
| Advances & loans | Summary cards, All/Open/Completed/Pending Approval tabs, request decisions, approved disbursement and recovery progress/history. Salary and manual recovery methods are explicit. |
| Daily diary | Date/class/teacher/status filters, entry and parent-view cards, published/missing activity chart, teacher performance, activity table, direct entry viewing and PDF/XLSX activity exports plus a teacher summary export. |
| Exams & results | Summary cards, workflow strip, academic-year/class/status/search filters, marks progress and Review/View results actions. Existing date-sheet approval, marks handling, grade scale and result publication are retained. |

## Loan approval and recovery

1. A user with `payroll.manage` submits a request containing staff, amount, type, proposed account/date, recovery method and reason.
2. Owner approves by default. In **Roles & permissions**, the owner may delegate **Approve or reject staff advances and loans** (`loan.approve`). A non-owner cannot approve their own request.
3. Approval alone does not affect money balances, journals, salary recovery or disbursed-loan reports.
4. The accountant records actual disbursement of the approved amount from its approved account. The payment date is validated; salary recovery starts no earlier than that month. The request is claimed atomically to prevent duplicate disbursements. Available funds, active records and closed-book dates are checked.
5. Salary loans enter payroll recovery; manual-repayment loans do not. Existing cash recovery remains available. Rejected requests cannot be paid.

For compatibility, the old direct issuance endpoint remains an explicit **Owner-only approval and issuance** operation, with an audit event. Delegated approvers must use the staged workflow and cannot bypass its independent-approval check. Existing disbursed loans are preserved and default to salary recovery.

## Diary expectations and views

Use **Daily diary → Diary rules**, available to Owner and Principal:

- Required coverage: one update per class per day, or one per assigned subject per day.
- Class mode uses the class teacher as the expected responsible person. Subject mode uses current-year subject assignments.
- Configure required weekdays and the branch-local daily deadline. Defaults are subject mode, Monday–Friday and 15:00.
- School holidays are excluded. Unassigned classes are flagged rather than inventing a responsible teacher.
- An unposted expected update is Pending before the deadline and Not updated afterward. Published entries are classified On time or Delayed.

Teachers publish directly, without an approval stage. This dashboard derives expected updates from the current rules and assignments, including when viewing earlier dates; it is not an immutable historical appraisal. Date ranges are limited to 31 days, and large activity exports require narrower filters.

Opening the family diary records views for the entries returned to that child's diary list on web/mobile. Parent views count each child at most once per entry, even when multiple guardians open it. Student logins cannot create parent views. The denominator uses current active students in each entry's section; it is not proof that a parent read every word. Homework completion stays separate from viewing.

The status selector filters the activity table/export. Summary cards and charts continue to describe the selected date/class/teacher context. Marks progress uses current active class rosters for its denominator and does not rewrite marks or historical published results.

## Setup

Two additive migrations create diary policy/view records, loan requests and the loan recovery-method column. They have been applied to the local development database. On another checkout/environment, stop the backend first and run from `backend/`:

```powershell
npx prisma migrate deploy
npx prisma generate
```

There are no new package dependencies. Existing records are not reset. Production deployment was not performed.

## Verification and retained dummy data

- Full backend regression pass: **40 suites / 421 tests passed**.
- Follow-up tests cover manual recovery, academic-year filtering, payment reference persistence and disbursement dates. The focused payroll/workflow/exam pass completed **32 tests**, and the final workflow suite completed **8 tests**.
- Backend, frontend and mobile TypeScript checks passed. Targeted frontend lint has zero errors; existing effect-rule warnings remain. The production frontend Webpack build passed.
- In-app browser checks cover populated payroll totals/breakdowns, loan balances/request form, diary summaries/chart/rules, student edit form, promotion dialog and exam filters. Real bank payments, production infrastructure and native mobile builds were not executed.
- New workflow fixtures are intentionally retained. Existing isolated test suites retain their own established cleanup behavior. Redis was unavailable locally, so runtime verification used the development in-memory fallback.

The workflow regression suite creates labelled **Workflow QA — retained** schools. To expose one through stable demo logins, run from `backend/`:

```powershell
$env:RUN_DB_TESTS='1'
npx jest src/__tests__/db/schoolWorkflows.db.test.ts --runInBand
npm run db:seed:workflows
```

Local demo usernames: `workflow.qa.owner`, `workflow.qa.principal`, `workflow.qa.accountant`, `workflow.qa.admin`, `workflow.qa.teacher`, `workflow.qa.parent`, `workflow.qa.student`. Password: `Test@12345` (non-production fixtures only). The setup command retains existing data, adds a future academic year and one labelled pending request without disbursing it, and refuses production. Original Reports QA data and its existing login remain available.
