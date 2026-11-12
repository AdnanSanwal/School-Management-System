import { Router, RequestHandler } from 'express';
import { tenantStorage } from '../../config/tenancy';
import multer from 'multer';
import { handler } from '../../utils/http';
import { readFile, verifySignature, UPLOAD_LIMIT_BYTES } from '../../utils/storage';
import { AppError } from '../../middleware/errorHandler';

const parseOne = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMIT_BYTES, files: 1, fields: 10 },
}).single('file');

/**
 * Multipart parser shared by upload endpoints: one file, kept in memory, size-capped.
 * Multer resumes the request from a stream callback, which drops the
 * AsyncLocalStorage tenant context — so re-enter the context captured here.
 */
export const uploadOne: RequestHandler = keepTenant(parseOne);

/** Up to `max` files in field "files" (e.g. diary attachments). */
export function uploadMany(max: number): RequestHandler {
  return keepTenant(multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMIT_BYTES, files: max, fields: 20 },
  }).array('files', max));
}

function keepTenant(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const ctx = tenantStorage.getStore();
    mw(req, res, (err?: unknown) => (ctx ? tenantStorage.run(ctx, () => next(err)) : next(err)));
  };
}

// Serves uploaded files to holders of a valid signed URL (see utils/storage.ts).
// No bearer token here on purpose: <img> tags and downloads can't send one.
const router = Router();

router.get(/^\/(.+)$/, handler(async (req, res) => {
  const key = (req.params as Record<string, string>)[0];
  if (!verifySignature(key, req.query.exp as string, req.query.sig as string)) {
    throw new AppError('Link expired or invalid', 403);
  }
  const { data, mime } = await readFile(key);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  // The web app runs on another origin; helmet's default would block <img> loads.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // Shared office computers: don't keep CNIC copies or payment proofs in the browser cache (FILE-2).
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(data);
}));

export default router;
