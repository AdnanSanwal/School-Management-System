import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { initSentry, setupSentryErrorHandler } from './utils/sentry';
import { gdprHeaders, auditConsent } from './middleware/gdpr';
import { metricsMiddleware, metricsHandler } from './utils/metrics';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

// Routes — ERP v2. Domain modules are added phase by phase (see docs/ERP_V2.md).
import authRoutes from './modules/auth/auth.routes';
import oauthRoutes from './modules/auth/oauth.routes';
import platformRoutes from './modules/platform/platform.routes';
import schoolRoutes from './modules/school/school.routes';
import userRoutes from './modules/users/users.routes';
import classRoutes from './modules/classes/classes.routes';
import staffRoutes from './modules/staff/staff.routes';
import studentRoutes from './modules/students/students.routes';
import attendanceRoutes from './modules/attendance/attendance.routes';
import feeRoutes from './modules/fees/fees.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import fileRoutes from './modules/files/files.routes';
import diaryRoutes from './modules/diary/diary.routes';
import noticeRoutes from './modules/notices/notices.routes';
import calendarRoutes from './modules/calendar/calendar.routes';
import familyRoutes from './modules/family/family.routes';
import examRoutes, { reportCardPdfRouter } from './modules/exams/exams.routes';
import timetableRoutes from './modules/timetable/timetable.routes';
import leaveRoutes from './modules/leave/leave.routes';
import approvalRoutes from './modules/approvals/approvals.routes';
import paymentRoutes from './modules/payments/payments.routes';
import reportRoutes from './modules/reports/reports.routes';
import promotionRoutes from './modules/promotions/promotions.routes';
import transportRoutes from './modules/transport/transport.routes';
import libraryRoutes from './modules/library/library.routes';
import messagingRoutes from './modules/messaging/messaging.routes';
import notificationRoutes from './modules/notifications/notification.routes';
import pushRoutes from './modules/push/push.routes';

const app = express();

// Behind a reverse proxy (Caddy in production) the client IP is in X-Forwarded-For.
// Without this every request looks like it comes from the proxy, so one busy school
// would hit the rate limit for everybody. Set TRUST_PROXY to the number of proxies.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// Sentry must be first
initSentry(app);

// Security headers (GDPR + helmet)
app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' }));
app.use(gdprHeaders);
const allowedOrigins = [
  ...(process.env.FRONTEND_URL || 'http://localhost:3000').split(','),
  ...(process.env.MOBILE_ORIGIN ? [process.env.MOBILE_ORIGIN] : []),
  // always allow localhost variants in development
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://127.0.0.1:3000', 'http://localhost:8081'] // 8081: Expo web preview
    : []),
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, mobile apps, Postman)
    if (!origin) return cb(null, true);
    // Unknown origin: answer without CORS headers (the browser then blocks reading the
    // response) instead of failing the request. Throwing here turned every cross-site
    // form post into a 500 — including payment-gateway callbacks posted from the
    // gateway's domain. Auth is a bearer token, not a cookie, so this is not a CSRF hole.
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Per client IP. A school office often shares one IP, so keep this generous.
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.RATE_LIMIT_MAX) || 1000, standardHeaders: true, legacyHeaders: false }));

// Body parsing & compression
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// API data is private and changes with every save (attendance, payments…). Browser
// caching made screens show stale data after a mutation, so never cache API
// responses; the web app caches client-side with React Query. Signed file
// downloads set their own Cache-Control in modules/files.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Logging + metrics
app.use(morgan('combined'));
app.use(metricsMiddleware);
app.use(auditConsent);

// Health & metrics
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/metrics', metricsHandler);

// API routes
const api = '/api/v1';
app.use(`${api}/auth`, authRoutes);
app.use(`${api}/auth/oauth`, oauthRoutes);
app.use(`${api}/platform`, platformRoutes);
app.use(`${api}/school`, schoolRoutes);
app.use(`${api}/users`, userRoutes);
app.use(`${api}/academics`, classRoutes);
app.use(`${api}/staff`, staffRoutes);
app.use(`${api}/students`, studentRoutes);
app.use(`${api}/attendance`, attendanceRoutes);
app.use(`${api}/fees`, feeRoutes);
app.use(`${api}/dashboard`, dashboardRoutes);
app.use(`${api}/files`, fileRoutes);
app.use(`${api}/diary`, diaryRoutes);
app.use(`${api}/notices`, noticeRoutes);
app.use(`${api}/calendar`, calendarRoutes);
app.use(`${api}/family`, familyRoutes);
app.use(`${api}/exams`, examRoutes);
app.use(`${api}/timetable`, timetableRoutes);
app.use(`${api}/leave`, leaveRoutes);
app.use(`${api}/approvals`, approvalRoutes);
app.use(`${api}/payments`, paymentRoutes);
app.use(`${api}/reports`, reportRoutes);
app.use(`${api}/promotions`, promotionRoutes);
app.use(`${api}/transport`, transportRoutes);
app.use(`${api}/library`, libraryRoutes);
app.use(`${api}/messaging`, messagingRoutes);
app.use(`${api}/report-cards`, reportCardPdfRouter);
app.use(`${api}/notifications`, notificationRoutes);
app.use(`${api}/push`, pushRoutes);

// Sentry v8 error handler (must be before custom error handler)
setupSentryErrorHandler(app);
app.use(notFound);
app.use(errorHandler);

export default app;
