// routes/dashboard.routes.ts
import { Router } from 'express';
import {
    getDashboardData,
    getFinancialSummary,
    getInventoryDashboard,
    getEmployeeDashboard
} from '../controllers/dashboard-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, getDashboardData);
router.get('/financial', authenticate, authorize(['ADMIN', 'MANAGER']), getFinancialSummary);
router.get('/inventory', authenticate, authorize(['ADMIN', 'MANAGER']), getInventoryDashboard);
router.get('/employees', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployeeDashboard);

export default router;