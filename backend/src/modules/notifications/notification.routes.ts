import { Router } from 'express';
import * as ctrl from './notification.controller';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import broadcasts from './broadcasts';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.get('/preferences', ctrl.getPreferences);
router.put('/preferences', ctrl.setPreferences);
router.use('/broadcasts', broadcasts);
router.post('/broadcast', can('message.broadcast', 'notice.publish'), ctrl.broadcast);
router.put('/:id/read', ctrl.markRead);
router.put('/read-all', ctrl.markAllRead);

export default router;
