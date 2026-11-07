/**
 * Uploads end-to-end against MySQL, with files written to a temp folder.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/uploads
 */
import 'dotenv/config';
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-uploads-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;
process.env.BACKEND_URL = 'http://test.local';

import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(60_000);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

d('student uploads (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  let studentId = '';
  let otherStudentId = '';
  let docHref = '';

  const auth = (role: string) => ({ Authorization: `Bearer ${tok[role]}` });
  const filePath = (href: string) => new URL(href).pathname + new URL(href).search;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('up');
    tok.ADMIN = (await t.user('ADMIN')).token;
    tok.ACCOUNTANT = (await t.user('ACCOUNTANT')).token;
    tok.OWNER = (await t.user('OWNER')).token;
    const cls = await request(app).post('/api/v1/academics/classes').set(auth('ADMIN')).send({ name: 'Class 1', level: 1, sections: ['A'] });
    const sectionId = cls.body.data.sections[0].id;
    const a = await request(app).post('/api/v1/students').set(auth('ADMIN')).send({
      name: 'Upload Kid', sectionId, guardians: [{ name: 'Up Parent', phone: '03005550000', relation: 'FATHER', loginEmail: `p.${t.code}@test.local` }],
    });
    studentId = a.body.data.student.id;
    tok.PARENT = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: a.body.data.parentLogins[0].user.id } }));
    const b = await request(app).post('/api/v1/students').set(auth('ADMIN')).send({
      name: 'Other Kid', sectionId, guardians: [{ name: 'Other Parent', phone: '03005550001', relation: 'MOTHER' }],
    });
    otherStudentId = b.body.data.student.id;
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  });

  it('uploads a PDF document and serves it through a signed link', async () => {
    const r = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ADMIN'))
      .field('title', 'Birth certificate').attach('file', PDF, { filename: 'bc.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ title: 'Birth certificate', uploaded: true, mimeType: 'application/pdf', sizeBytes: PDF.length });
    expect(r.body.data).not.toHaveProperty('storageKey');
    docHref = r.body.data.href;
    expect(docHref).toMatch(/^http:\/\/test\.local\/api\/v1\/files\/.+\?exp=\d+&sig=/);

    const f = await request(app).get(filePath(docHref));
    expect(f.status).toBe(200);
    expect(f.headers['content-type']).toBe('application/pdf');
    expect(f.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(Buffer.from(f.body).equals(PDF)).toBe(true);
  });

  it('stores files under the school folder on disk', () => {
    const key = new URL(docHref).pathname.replace('/api/v1/files/', '');
    expect(key.startsWith(`${t.school.id}/documents/`)).toBe(true);
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(true);
  });

  it('a tampered or unsigned link is refused', async () => {
    const u = new URL(docHref);
    expect((await request(app).get(u.pathname)).status).toBe(403);
    u.searchParams.set('sig', 'AAAA' + u.searchParams.get('sig')!.slice(4));
    expect((await request(app).get(u.pathname + u.search)).status).toBe(403);
  });

  it('rejects a disguised executable and oversized files', async () => {
    const exe = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ADMIN'))
      .field('title', 'Totally a PDF').attach('file', Buffer.from('MZ\x90\x00not a pdf'), { filename: 'cert.pdf', contentType: 'application/pdf' });
    expect(exe.status).toBe(415);
    const big = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ADMIN'))
      .field('title', 'Huge').attach('file', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 10)]), 'huge.pdf');
    expect(big.status).toBe(413);
  });

  it('link documents must be http(s)', async () => {
    const bad = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ADMIN'))
      .send({ title: 'XSS', url: 'javascript:alert(1)' });
    expect(bad.status).toBe(422);
    const ok = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ADMIN'))
      .send({ title: 'Drive scan', url: 'https://example.com/scan.pdf' });
    expect(ok.body.data).toMatchObject({ uploaded: false, href: 'https://example.com/scan.pdf' });
  });

  it('only office staff with student.manage can upload', async () => {
    const r = await request(app).post(`/api/v1/students/${studentId}/documents`).set(auth('ACCOUNTANT'))
      .field('title', 'x').attach('file', PDF, 'x.pdf');
    expect(r.status).toBe(403);
  });

  it('uploads a photo; PDFs are not accepted as photos', async () => {
    const no = await request(app).put(`/api/v1/students/${studentId}/photo`).set(auth('ADMIN')).attach('file', PDF, 'p.pdf');
    expect(no.status).toBe(415);
    const r = await request(app).put(`/api/v1/students/${studentId}/photo`).set(auth('ADMIN')).attach('file', PNG, 'p.png');
    expect(r.status).toBe(200);
    const img = await request(app).get(filePath(r.body.data.photo));
    expect(img.headers['content-type']).toBe('image/png');
  });

  it('parent sees their child\'s photo and documents, not another child\'s', async () => {
    const mine = await request(app).get(`/api/v1/students/${studentId}`).set(auth('PARENT'));
    expect(mine.body.data.photo).toMatch(/\/api\/v1\/files\//);
    // Regression: API GETs used to be browser-cached for 60s, so screens showed stale data after saving.
    expect(mine.headers['cache-control']).toBe('no-store');
    expect(mine.body.data.documents.map((x: any) => x.title).sort()).toEqual(['Birth certificate', 'Drive scan']);
    expect((await request(app).get(`/api/v1/students/${otherStudentId}`).set(auth('PARENT'))).status).toBe(404);
  });

  it('deleting a document removes the file', async () => {
    const prof = await request(app).get(`/api/v1/students/${studentId}`).set(auth('ADMIN'));
    const doc = prof.body.data.documents.find((x: any) => x.uploaded);
    const key = new URL(doc.href).pathname.replace('/api/v1/files/', '');
    const r = await request(app).delete(`/api/v1/students/${studentId}/documents/${doc.id}`).set(auth('ADMIN'));
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(false);
    expect((await request(app).get(filePath(doc.href))).status).toBe(404);
  });

  it('owner can view concessions read-only; parent cannot', async () => {
    expect((await request(app).get('/api/v1/fees/concessions').set(auth('OWNER'))).status).toBe(200);
    expect((await request(app).get('/api/v1/fees/concessions').set(auth('PARENT'))).status).toBe(403);
  });
});
