// routes/sales-dashboard.routes.ts
import { Router } from 'express';
import {
    getSalesDashboardSummary,
    getRecentActivity,
    getTopProducts,
    getStorePerformance,
    getRealtimeUpdates,
    getSalesByHour,
    getSalesByDay,
    getSalesByWeek,
    getSalesByMonth,
    getSalesByYear,
    getTopProductsByStore
} from '../controllers/sales-dashboard-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes are under /sales/dashboard
router.get('/summary', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesDashboardSummary);
router.get('/recent-activity', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getRecentActivity);
router.get('/top-products', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getTopProducts);
router.get('/top-products/:storeId', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getTopProductsByStore);
router.get('/store-performance', authenticate, authorize(['ADMIN', 'MANAGER']), getStorePerformance);
router.get('/realtime', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getRealtimeUpdates);
router.get('/sales-by-hour', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesByHour);
router.get('/sales-by-day', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesByDay);
router.get('/sales-by-week', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesByWeek);
router.get('/sales-by-month', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesByMonth);
router.get('/sales-by-year', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesByYear);

export default router;