import { z } from 'zod';
import { handler, parseBody } from '../../utils/http';
import { sendSuccess } from '../../utils/apiResponse';
import { switchBranch } from './auth.service';
import { Router } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loginAccountLimiter, loginIdentityLimiter, loginIpLimiter, lookupLimiter, mfaLimiter, passwordCheckLimiter, passwordResetLimiter, refreshLimiter } from '../../middleware/rateLimits';
import { loginSchema, changePasswordSchema, profileSchema, forgotPasswordSchema, resetPasswordSchema, mfaCodeSchema, disableMfaSchema, enableMfaSchema } from './auth.schema';

const router = Router();

router.post('/login', loginIpLimiter, loginIdentityLimiter, loginAccountLimiter, validate(loginSchema), authController.login);
router.post('/refresh', refreshLimiter, authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post('/change-password', authenticate, passwordCheckLimiter, validate(changePasswordSchema), authController.changePassword);
router.post('/mfa/enable', authenticate, passwordCheckLimiter, validate(enableMfaSchema), authController.enableMFA);
router.post('/mfa/verify', authenticate, mfaLimiter, validate(mfaCodeSchema), authController.verifyMFA);
router.post('/mfa/disable', authenticate, passwordCheckLimiter, validate(disableMfaSchema), authController.disableMFA);
router.post('/switch-branch', authenticate, handler(async (req, res) => {
  const { schoolId } = parseBody(z.object({ schoolId: z.string().uuid() }).strict(), req);
  return sendSuccess(res, await switchBranch(req.user!.id, schoolId, req.user!, req.headers.authorization!.split(' ')[1]), 'Branch switched');
}));
router.get('/me', authenticate, authController.getMe);
router.patch('/profile', authenticate, passwordCheckLimiter, validate(profileSchema), authController.updateProfile);
router.get('/username-check', authenticate, lookupLimiter, authController.usernameCheck);

export default router;
