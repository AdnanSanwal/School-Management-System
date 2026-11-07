import { Router } from 'express';
import * as ctrl from './push.controller';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';

const router = Router();
router.use(authenticate);

router.post('/subscribe', ctrl.subscribe);
router.delete('/unsubscribe', ctrl.unsubscribe);
router.post('/send', can('message.broadcast'), ctrl.sendPush);
router.get('/vapid-key', ctrl.getVapidKey);

export default router;
