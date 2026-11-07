import { Request, Response, NextFunction } from 'express';

// Adds GDPR-required response headers
export function gdprHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

// Consent audit log middleware
export function auditConsent(req: Request, _res: Response, next: NextFunction) {
  if (req.method !== 'GET') {
    // In production wire this to an audit log table / external SIEM
    const record = {
      ip: req.ip,
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString(),
    };
    // logger.debug('Audit', record); // uncomment to log every mutating request
  }
  next();
}
