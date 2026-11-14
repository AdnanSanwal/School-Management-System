import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { handler, parseBody, parseQuery, dateOnly, id, me } from '../../utils/http';
import { sendSuccess } from '../../utils/apiResponse';
import { addDays, toDate, toIso, schoolToday, schoolTimezone, zonedDayStart } from '../../utils/dates';
import { assertStudentAccess, currentAcademicYear, isSchoolWide, staffForUser, teacherSectionIds } from '../../utils/scope';
import { toPdf, toXlsx, TableReport } from '../../utils/tableReport';
import { audit } from '../../utils/audit';

const router = Router();
router.get('/options',can('diary.view','diary.post'),handler(async(req,res)=>{
  const user=me(req);if(['PARENT','STUDENT'].includes(user.role))throw new AppError('Not available',403);
  const teachers=await prisma.staff.findMany({where:{...(isSchoolWide(user)?{OR:[{isTeacher:true},{diaryEntries:{some:{}}}]}:{userId:user.id})},select:{id:true,name:true},orderBy:{name:'asc'}});
  return sendSuccess(res,{teachers});
}));
const policyBody = z.object({ mode: z.enum(['CLASS', 'SUBJECT']), deadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length, 'Choose each weekday once') });
export async function diaryPolicy() { const r = await prisma.diaryPolicy.findFirst(); return r ? { mode: r.mode, deadline: r.deadline, weekdays: r.weekdays as number[] } : { mode: 'SUBJECT', deadline: '15:00', weekdays: [1,2,3,4,5] }; }
router.get('/policy', can('diary.view', 'diary.post'), handler(async (_req, res) => sendSuccess(res, await diaryPolicy())));
router.put('/policy', can('diary.configure'), handler(async (req, res) => {
  if (!['OWNER', 'PRINCIPAL'].includes(me(req).role)) throw new AppError('Only the owner or principal can configure diary expectations', 403);
  const b = parseBody(policyBody, req); const schoolId = currentSchoolId();
  await prisma.diaryPolicy.upsert({ where: { schoolId }, create: { schoolId, ...b }, update: b });
  await audit(req, { action: 'Diary expectations changed', entity: 'diary-policy', meta: b });
  return sendSuccess(res, b, 'Diary rules saved');
}));

router.post('/views', can('diary.view'), handler(async (req, res) => {
  if (me(req).role !== 'PARENT') throw new AppError('Only parent views are counted', 403);
  const b = parseBody(z.object({ studentId: id, entryIds: z.array(id).min(1).max(50) }), req);
  await assertStudentAccess(me(req), b.studentId);
  const student = await prisma.student.findFirstOrThrow({ where: { id: b.studentId } });
  const entries = await prisma.diaryEntry.findMany({ where: { id: { in: b.entryIds }, sectionId: student.sectionId ?? '-' }, select: { id: true } });
  if (entries.length !== new Set(b.entryIds).size) throw new AppError('Diary entry not found for this child', 404);
  await prisma.diaryView.createMany({ data: entries.map(e => ({ schoolId: currentSchoolId(), diaryEntryId: e.id, studentId: student.id })), skipDuplicates: true });
  return sendSuccess(res, null);
}));

router.get('/dashboard', can('diary.view', 'diary.post'), handler(async (req, res) => {
  const user = me(req);
  if (['PARENT', 'STUDENT'].includes(user.role)) throw new AppError('Dashboard not available', 403);
  const q = parseQuery(z.object({ from: dateOnly.optional(), to: dateOnly.optional(), sectionId: id.optional(), classId: id.optional(), teacherId: id.optional(), status: z.enum(['PUBLISHED', 'ON_TIME', 'DELAYED', 'PENDING', 'NOT_UPDATED']).optional(), format: z.enum(['view', 'pdf', 'xlsx']).default('view'), report:z.enum(['activity','teachers']).default('activity') }), req);
  const today = await schoolToday(), start = q.from ? toDate(q.from) : addDays(today, -6), end = q.to ? toDate(q.to) : today;
  if (toIso(start) !== (q.from ?? toIso(start)) || toIso(end) !== (q.to ?? toIso(end)) || end < start || +end - +start > 30 * 86400000 || end > today) throw new AppError('Choose a valid range of at most 31 days, not in the future', 422);
  const own = !isSchoolWide(user) ? await staffForUser(user.id) : null;
  const allowed = !isSchoolWide(user) ? await teacherSectionIds(user.id) : undefined;
  if (q.sectionId && allowed && !allowed.includes(q.sectionId)) throw new AppError('Section not found', 404);
  if (own && q.teacherId && q.teacherId !== own.id) throw new AppError('Teacher not found', 404);
  const teacherId = own?.id ?? q.teacherId;
  const year = await currentAcademicYear();
  const [policy, timezone, sections, entries, holidays, students] = await Promise.all([
    diaryPolicy(), schoolTimezone(),
    prisma.section.findMany({ where: { ...(allowed ? { id: { in: allowed } } : {}), ...(q.sectionId ? { id: q.sectionId } : {}), ...(q.classId ? { classId: q.classId } : {}), class: { archivedAt: null } }, include: { class: true, classTeacher: true, subjectTeachers: { where: { academicYearId: year.id }, include: { teacher: true, subject: true } } } }),
    prisma.diaryEntry.findMany({ where: { date: { gte: start, lte: end }, ...(teacherId ? { teacherId } : {}), ...(allowed ? { sectionId: { in: allowed } } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}), ...(q.classId ? { section: { classId: q.classId } } : {}) }, include: { teacher: true, subject: true, section: { include: { class: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 10001 }),
    prisma.calendarEvent.findMany({ where: { type: 'HOLIDAY', startDate: { lte: end }, endDate: { gte: start } } }),
    prisma.student.findMany({ where: { status: 'ACTIVE', ...(allowed ? { sectionId: { in: allowed } } : {}) }, select: { id: true, sectionId: true } }),
  ]);
  if (entries.length > 10000) throw new AppError('Too many entries. Narrow the date range or class filter.', 422);
  const views = await prisma.diaryView.findMany({ where: { diaryEntryId: { in: entries.map(e => e.id) } } });
  const viewed = new Set(views.map(v => `${v.diaryEntryId}:${v.studentId}`));
  let audiences = 0, seen = 0;
  const rows: any[] = entries.map(e => {
    const date = toIso(e.date);
    const deadline = new Date(+zonedDayStart(date, timezone) + (Number(policy.deadline.slice(0,2)) * 60 + Number(policy.deadline.slice(3))) * 60000);
    const audience = students.filter(s => s.sectionId === e.sectionId); audiences += audience.length;
    const readers = audience.filter(s => viewed.has(`${e.id}:${s.id}`)).length; seen += readers;
    return { id: e.id, date, sectionId: e.sectionId, section: `${e.section.class.name}-${e.section.name}`, teacherId: e.teacherId, teacher: e.teacher.name, subjectId: e.subjectId, subject: e.subject?.name ?? 'General', title: e.title ?? e.content.slice(0,120), content: e.content, status: e.createdAt <= deadline ? 'ON_TIME' : 'DELAYED', published: true, visible: true, readers, audience: audience.length };
  });
  let expected = 0;
  const unassigned = sections.filter(s => policy.mode === 'CLASS' ? !s.classTeacherId : !s.subjectTeachers.length).map(s => `${s.class.name}-${s.name}`);
  for (let date = start; date <= end; date = addDays(date,1)) {
    if (!policy.weekdays.includes(date.getUTCDay()) || holidays.some(h => h.startDate <= date && h.endDate >= date)) continue;
    const iso = toIso(date);
    const deadline = new Date(+zonedDayStart(iso,timezone) + (Number(policy.deadline.slice(0,2))*60+Number(policy.deadline.slice(3)))*60000);
    for (const s of sections) {
      const assignments = policy.mode === 'CLASS' ? (s.classTeacher ? [{ teacher: s.classTeacher, teacherId: s.classTeacher.id, subjectId: null, subject: null }] : []) : s.subjectTeachers;
      for (const a of assignments) {
        if (teacherId && a.teacherId !== teacherId) continue;
        expected++;
        if (rows.some(r => r.published && r.date === iso && r.sectionId === s.id && (policy.mode === 'CLASS' || (r.teacherId === a.teacherId && r.subjectId === a.subjectId)))) continue;
        rows.push({ id: `missing:${iso}:${s.id}:${a.subjectId}`, date: iso, sectionId: s.id, section: `${s.class.name}-${s.name}`, teacherId: a.teacherId, teacher: a.teacher.name, subjectId: a.subjectId, subject: a.subject?.name ?? 'Class update', title: 'Update not posted', status: new Date() <= deadline ? 'PENDING' : 'NOT_UPDATED', published: false, visible: false, readers: 0, audience: 0 });
      }
    }
  }
  const performance = [...new Set(rows.map(r => r.teacherId))].map(tid => {
    const rs = rows.filter(r => r.teacherId === tid);
    return { teacherId: tid, teacher: rs[0].teacher, onTime: rs.filter(r => r.status === 'ON_TIME').length, delayed: rs.filter(r => r.status === 'DELAYED').length, missing: rs.filter(r => !r.published).length };
  });
  const overview = Array.from({length: Math.round((+end-+start)/86400000)+1},(_,i) => { const date=toIso(addDays(start,i));return {date,published:rows.filter(r=>r.date===date&&r.published).length,pending:rows.filter(r=>r.date===date&&!r.published).length}; });
  const filtered = rows.filter(r => !q.status || (q.status === 'PUBLISHED' ? r.published : r.status === q.status)).sort((a,b)=>b.date.localeCompare(a.date)||a.section.localeCompare(b.section));
  const result = { rows: filtered, policy, timezone, unassigned, overview, performance, expected, stats: { entries: entries.length, teachersUpdated: new Set(entries.map(e=>e.teacherId)).size, pending: rows.filter(r=>!r.published).length, parentViews: audiences ? Math.round(seen/audiences*100) : null }, teachers: [...new Map(rows.map(r=>[r.teacherId,{id:r.teacherId,name:r.teacher}])).values()] };
  if (q.format === 'view') return sendSuccess(res,result);
  const school = await prisma.school.findUniqueOrThrow({where:{id:currentSchoolId()}});
  const report: TableReport = { title:'Daily diary activity', subtitle:`${toIso(start)} to ${toIso(end)}`,school:school.name,currency:school.currency,columns:[{key:'date',label:'Date'},{key:'section',label:'Class'},{key:'teacher',label:'Teacher'},{key:'subject',label:'Subject'},{key:'title',label:'Topic / homework'},{key:'status',label:'Status'}],rows:filtered.map(({date,section,teacher,subject,title,status})=>({date,section,teacher,subject,title,status})),notes:[`Deadline ${policy.deadline} (${timezone}); missing updates follow configured weekdays and exclude school holidays. Parent views count each child once per entry.`] };
  if(q.report==='teachers'){report.title='Diary teacher performance';report.columns=[{key:'teacher',label:'Teacher'},{key:'onTime',label:'On time',type:'number'},{key:'delayed',label:'Delayed',type:'number'},{key:'missing',label:'Pending / missing',type:'number'}];report.rows=performance.map(({teacher,onTime,delayed,missing})=>({teacher,onTime,delayed,missing}));}
  const buffer=q.format==='pdf'?await toPdf(report):await toXlsx(report);
  res.setHeader('Content-Type',q.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="daily-diary.${q.format}"`);return res.send(buffer);
}));

export default router;
