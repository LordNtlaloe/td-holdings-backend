import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { ActivityController } from '../controllers/stash/activity-controller';

const router = express.Router();
const activityController = new ActivityController();

// All activity routes require manager/admin roles
router.get('/',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    activityController.getActivityLogs
);

router.get('/summary',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    activityController.getActivitySummary
);

export default router;