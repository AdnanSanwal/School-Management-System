import { Router } from 'express';
import * as ctrl from './notification.controller';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/broadcast', can('message.broadcast', 'notice.publish'), ctrl.broadcast);
router.put('/:id/read', ctrl.markRead);
router.put('/read-all', ctrl.markAllRead);

export default router;
