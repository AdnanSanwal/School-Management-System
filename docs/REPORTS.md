# Reports and verification

Open **Reports** in the sidebar. Search the catalogue, expand a report's filters and choose View, PDF or Excel. View preserves the selected filters; change them with Apply changes or restore defaults with Reset. Screen search filters displayed rows; use report filters to control exported data.

## Coverage and filters

| Reports | Available filters (as relevant to each report) |
| --- | --- |
| Fee collection, monthly fee summary, defaulters | Dates/month, class, section, student, payment method |
| Student attendance register, class strength | Month, class, section |
| Staff directory, attendance summary, attendance detail | Month/dates, staff, department, designation, staff status |
| Salary structures | Effective date, staff, department, designation, status |
| Payroll summary and employee detail | Payroll month range, payroll status, staff, department, designation |
| Advances and loans, loan recoveries | Dates, staff, advance/loan kind, status, recovery method |
| Money account balances, account transactions/day book | Dates/as-of date, account, account type, active status |
| Expenses, other income | Dates, account, category, approval status for expenses, search |
| Library stock, circulation and fines | Book/category, availability, issue status, issue dates, student/class/section |
| Transport routes, student assignments | Route, active status, assignment dates, student/class/section/status |
| Chart of accounts, trial balance, balance sheet | As-of date, ledger account/type, active status where applicable |
| Income statement, journal, account ledger | Dates, ledger account/type as applicable; account ledger requires an account |
| Leave requests, leave balances | Dates/year, academic year, staff/department/designation/status, leave type/decision as applicable |

There are **29 report types**. Controls are specific to the report. Current stock, outstanding loans, unpaid library fines and current transport assignments are explicitly distinguished from historical date-filtered movements. Library estimated fines are separate from charged fines; draft payroll is not treated as paid. Transport expected revenue is not collected revenue. Reports exceeding 20,000 rows require narrower filters.

## Access and isolation

Reports require their module permissions. Branch-wide HR, finance, payroll, library and transport reports additionally require an office role. Teachers retain the existing own-section student attendance reporting. Parent/student accounts cannot download branch-wide reports. Options and report rows are scoped to the current branch; changing the branch changes the report scope.

## Retained demo data

Run from `backend/`:

```sh
npm run db:seed:reports
```

This idempotent seed refuses production and retains existing QA fixtures. Brand: **Reports QA — retained test data**. Branches: **Reports QA Main** and **Reports QA Isolation Branch**. Demo owner username: `reports.qa.owner`; demo password: `ReportsQA!2026`. These are local test credentials, not production accounts. Other seeded logins use `reports.qa.<role>`.

Use **November 2026** for dated reports, and **2026-11-30** for accounting/salary snapshots. Fixtures include paid/draft payroll, historical/future salaries, advances and loans, recoveries, approved/pending/rejected expenses, account transfers, partially paid fees, overdue/returned library books, route riders, attendance and leave. Nothing in these fixtures is deleted after testing.

Independent expected values: QA Cash closing balance **96,000**, QA Bank **172,000**, November trial balance debits and credits **308,500** each, paid payroll net **30,000**, remaining loan **7,000**. The overdue library estimate changes with today's date; it was **80** on 2026-11-13.

## Test results (2026-11-13)

- Full backend run: **38 suites, 411 tests passed**.
- Follow-up report regression run after the library-fine fix: **11 tests passed**. Checks every report in JSON/PDF/XLSX, exact Excel values against JSON, independently expected totals, filters, invalid dates, permissions and cross-branch isolation.
- Backend/frontend TypeScript checks and targeted frontend lint passed; production frontend Webpack build passed.
- In-app browser: catalogue/search, filter-to-View navigation, approved cash expenses and overdue library filtering verified. The overdue row displayed a numeric estimate instead of NaN.
- **30 PDFs** parsed successfully with no blank/near-blank pages or non-finite numbers. Representative reports visually inspected; a 120-row, three-page stress export preserved every row exactly once. XLSX exports also cover long text, zeros and nulls.
- Export evidence is retained locally under `artifacts/reports-qa/` (ignored by Git), including `verified-catalog.json`, `pdf-verification.json`, PDFs, spreadsheets and rendered previews.

Re-run the report suite from `backend/` with a local test database configured:

```sh
# PowerShell
$env:RUN_DB_TESTS='1'
npx jest src/__tests__/db/reports.db.test.ts --runInBand
```

Tests intentionally retain QA records. The normal isolated fixtures from other suites still follow their existing cleanup behavior. Local verification does not certify production infrastructure, real production data volume or mobile native builds. Temporary preview servers were stopped after verification.
