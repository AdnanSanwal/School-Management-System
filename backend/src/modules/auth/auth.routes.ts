import { Router } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { loginAccountLimiter, loginIpLimiter, mfaLimiter, passwordResetLimiter } from '../../middleware/rateLimits';
import { loginSchema, changePasswordSchema, profileSchema, forgotPasswordSchema, resetPasswordSchema, mfaCodeSchema, disableMfaSchema } from './auth.schema';

const router = Router();

router.post('/login', loginIpLimiter, loginAccountLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.post('/mfa/enable', authenticate, authController.enableMFA);
router.post('/mfa/verify', authenticate, mfaLimiter, validate(mfaCodeSchema), authController.verifyMFA);
router.post('/mfa/disable', authenticate, mfaLimiter, validate(disableMfaSchema), authController.disableMFA);
router.get('/me', authenticate, authController.getMe);
router.patch('/profile', authenticate, validate(profileSchema), authController.updateProfile);

export default router;
