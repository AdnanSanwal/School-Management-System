import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { checkUsername } from '../../utils/usernames';
import { AuthRequest } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/apiResponse';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, mfaCode } = req.body;
    const result = await authService.login(email, password, mfaCode, req.ip);
    return sendSuccess(res, result, 'Login successful');
  } catch (err) { next(err); }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return sendError(res, 'Refresh token required', 400);
    const result = await authService.refreshAccessToken(refreshToken);
    return sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization!.split(' ')[1];
    await authService.logout(req.user!, token);
    return sendSuccess(res, null, 'Logged out successfully');
  } catch (err) { next(err); }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.forgotPassword(req.body.email);
    return sendSuccess(res, null, 'If the email exists, a reset link has been sent');
  } catch (err) { next(err); }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    return sendSuccess(res, null, 'Password reset successful');
  } catch (err) { next(err); }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req.user!.sid, req.user!.schoolId);
    return sendSuccess(res, result, 'Password changed');
  } catch (err) { next(err); }
}

export async function enableMFA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await authService.enableMFA(req.user!.id, req.body.password);
    return sendSuccess(res, result, 'Scan QR code with authenticator app');
  } catch (err) { next(err); }
}

export async function verifyMFA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await authService.verifyMFA(req.user!.id, req.body.code);
    return sendSuccess(res, null, 'MFA enabled');
  } catch (err) { next(err); }
}

export async function disableMFA(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await authService.disableMFA(req.user!.id, req.body.password, req.user!.sid);
    return sendSuccess(res, null, 'MFA disabled');
  } catch (err) { next(err); }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await authService.getMe(req.user!.id, req.user!.schoolId));
  } catch (err) { next(err); }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await authService.updateProfile(req.user!.id, req.body);
    return sendSuccess(res, await authService.getMe(req.user!.id, req.user!.schoolId), 'Profile saved');
  } catch (err) { next(err); }
}

/** Is a username free? For the signed-in user's own profile (their current name counts as free). */
export async function usernameCheck(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const raw = String(req.query.username ?? '');
    const result = await checkUsername(raw, { name: String(req.query.name ?? ''), exceptUserId: req.user!.id });
    return sendSuccess(res, result);
  } catch (err) { next(err); }
}
