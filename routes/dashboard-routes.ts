import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { DashboardController } from '../controllers/stash/dashboard-controller';

const router = express.Router();
const dashboardController = new DashboardController();

// All dashboard routes require authentication
router.get('/',
    authenticate,
    dashboardController.getDashboardData
);

router.get('/sales-chart',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    dashboardController.getSalesChartData
);

router.get('/inventory-chart',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    dashboardController.getInventoryChartData
);

router.get('/employee-performance',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    dashboardController.getEmployeePerformance
);

export default router;