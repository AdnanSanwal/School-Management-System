import { Request, Response } from 'express';

export function notFound(req: Request, res: Response) {
  // Path only: query strings may carry signatures or tokens.
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
}
