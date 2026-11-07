import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/errorHandler';

/**
 * File storage for uploads (student documents, photos).
 *
 * Files are private: nothing is served by public path. The API returns
 * short-lived signed URLs (HMAC over key + expiry) that `GET /api/v1/files/...`
 * verifies, so <img src> and download links work without an auth header.
 *
 * Driver: local disk under UPLOAD_DIR (default backend/uploads). Keys always
 * start with the school id, so a key can never point into another school's
 * folder. To move to S3, implement the same four functions with the AWS SDK
 * (put/get/delete + presigned GET) and switch on STORAGE_DRIVER.
 */

const ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
const MAX_BYTES = 5 * 1024 * 1024;
const KEY_RE = /^[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;

export const UPLOAD_LIMIT_BYTES = MAX_BYTES;

export type FileKind = 'pdf' | 'jpg' | 'png' | 'webp';

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

/** Identifies a file by its first bytes — never trust the client's filename or Content-Type. */
export function sniff(buf: Buffer): FileKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function assertKind(buf: Buffer, allowed: FileKind[]): FileKind {
  if (buf.length > MAX_BYTES) throw new AppError('File is larger than 5 MB', 413);
  const kind = sniff(buf);
  if (!kind || !allowed.includes(kind)) {
    throw new AppError(`Unsupported file. Allowed: ${allowed.map((k) => k.toUpperCase()).join(', ')}`, 415);
  }
  return kind;
}

function fullPath(key: string) {
  if (!KEY_RE.test(key)) throw new AppError('File not found', 404);
  const p = path.join(ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new AppError('File not found', 404);
  return p;
}

export async function saveFile(schoolId: string, folder: 'documents' | 'photos', buf: Buffer, kind: FileKind): Promise<string> {
  const key = `${schoolId}/${folder}/${crypto.randomUUID()}.${kind}`;
  const p = fullPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, buf, { flag: 'wx' });
  return key;
}

export async function readFile(key: string): Promise<{ data: Buffer; mime: string }> {
  const p = fullPath(key);
  try {
    const data = await fs.readFile(p);
    return { data, mime: MIME[path.extname(key).slice(1) as FileKind] };
  } catch {
    throw new AppError('File not found', 404);
  }
}

export async function deleteFile(key: string | null | undefined) {
  if (!key) return;
  await fs.rm(fullPath(key), { force: true });
}

export function keyBelongsTo(key: string, schoolId: string) {
  return key.startsWith(`${schoolId}/`);
}

// ─── Signed URLs ───

function secret() {
  const s = process.env.FILE_URL_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error('FILE_URL_SECRET or JWT_SECRET must be set');
  return s;
}

function sign(key: string, exp: number) {
  return crypto.createHmac('sha256', secret()).update(`${key}\n${exp}`).digest('base64url');
}

/** Absolute URL valid for `ttlSeconds` (default 1 hour). */
export function signedUrl(key: string | null | undefined, ttlSeconds = 3600): string | null {
  if (!key) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const base = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
  return `${base}/api/v1/files/${key}?exp=${exp}&sig=${sign(key, exp)}`;
}

export function verifySignature(key: string, exp: string | undefined, sig: string | undefined): boolean {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(key, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
