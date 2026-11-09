# Changelog

## 10 November 2026 — SchoolPro change request (Admin level, v1.0)

This release covers everything in *SchoolPro_Change_Request_Requirements.pdf*, plus timetable
printing and staff reactivation. Every feature reads and writes the live database. 237 backend
tests pass, including the new `changeRequest.db.test.ts`.

### CR-01 · Dashboard cards are clickable

- Clicking a card opens a full table of that card's live records:
  - **Fee collected today:** student, class, months paid, method and reference, receipt link, amount, and the day's total.
  - **Total remaining fee:** every student who still owes fees, with parent, phone, months, oldest due date and remaining balance. The total matches the card.
  - **Teachers present today:** every teacher's status, check-in and check-out times, and leave notes. Present teachers are listed first.
  - **Students present today:** each present student's class, roll number and status, with counts per class.
  - **Alerts:** every current alert in one place: fees overdue more than 30 days, attendance not marked, low attendance, teachers absent or on leave, and pending concessions, leave requests and online payments. Each group links to the page where it can be dealt with.
- Each card opens only its own data, and only for roles allowed to see it.
- Each table can be searched.
- API: `GET /api/v1/dashboard/details/{fees-today|outstanding|staff-present|students-present|alerts}`.

### CR-02 · In-app report view

- Every report card has a **View** button next to **PDF** and **Excel**.
- The view page (`/reports/<report>`):
  - shows the report's filters, applied with **Apply**, plus **Reset**
  - updates the table on the same page
  - has a search box, and a totals row and notes where the report has them
- Viewing never downloads anything. PDF and Excel remain separate buttons.
- New filters:
  - **Fee collection:** date range, by class, by student.
  - **Monthly fee summary:** by class, by student.
  - **Defaulters:** by class, by student, overdue days.
  - **Class strength:** by class.
  - **Attendance register, teacher attendance and leave:** keep their date, month and section filters.
- API: `format=view` on `GET /api/v1/reports/:type` returns the same table as JSON.

### CR-03 · Classes section

- Classes without any section are hidden. A link shows them when needed.
- **Delete class** sits on each class card and opens a confirmation dialog in which the class name must be typed. As agreed, the class is **archived**:
  - It is hidden from every list, dropdown, fee grid, promotion and report.
  - Its students, invoices, payments, attendance and results are kept.
  - Its timetable is cleared and its class teachers are unassigned.
  - It is refused while the class still has active students.
  - It can be restored from **Archived classes**.
- **Promote students** is at the top right of the Classes section.
- API: `POST /academics/classes/:id/archive`, `POST /academics/classes/:id/restore`, `GET /academics/classes?archived=true`. The old hard delete route is gone.

### CR-04 · Monthly Fee at admission

- **Admission form:** a new **Monthly Fee** field, prefilled with the chosen class's monthly fee and editable for that student only.
- **Billing:** each student's amount is saved on their own record. Monthly invoices bill it as one "Monthly Fee" line in place of the class's monthly heads. Annual and one-time charges, transport and concessions still apply. Other students are never affected.
- **Student profile:** the Fees card shows the monthly fee. **Change** lets you edit it or go back to the class fee.
- **Permissions:** accountants can now create admissions and set the monthly fee. Editing students stays with the principal and admin.
- API: `monthlyFee` on `POST /students`, `PUT /students/:id/monthly-fee`.

### CR-05 · Staff login credentials

- **Add staff:** Staff name, Email (optional), Username, Password, Confirm password, Role / designation.
  - **Usernames** are unique across the platform and checked as you type. If one is taken, the form says so and offers free alternatives, which fill in with one click.
  - **Passwords** are stored only as bcrypt hashes.
- **First sign-in:** the staff member must set their own password before using the web or mobile app. The server refuses other requests until they do.
- **Sign-in:** the box accepts a username or an email, on both web and mobile.
- **My account:** staff can change their username or email, which needs their current password, and their password. Changing the password signs out their other devices.
- **Office users** (Users & logins) use the same username and password form.
- **Separation:** a person can only change their own details. Office password resets also force a new password at next sign-in.

### Also in this release

- **Print timetables:**
  - **Print** produces the class or teacher week as a clean A4 landscape sheet with the school name.
  - **Print all classes** prints one class per page, skipping classes with no timetable.
- **Reactivate staff:** staff marked as left show a **Reactivate** button, and their login works again. Marking someone as left now also signs them out of every device.
- **Timetable editor:** teachers already in another class at that time are greyed out, with the reason.

### For administrators

- **Database migration:** `20261110090000_cr_usernames_monthly_fee_archive`. It only adds columns and makes email optional, so existing data is unchanged.
- **Existing accounts:** these keep signing in with their email. Usernames can be added under My account.
