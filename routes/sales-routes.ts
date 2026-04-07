// routes/sales.routes.ts
import { Router } from 'express';
import {
    getSales,
    getSaleById,
    createSale,
    voidSale,
    getSalesReport,
    getSalesTrend,
    getVoidedSales
} from '../controllers/sales-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSales);
router.get('/:id', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSaleById);
router.post('/', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), createSale);
router.post('/:id/void', authenticate, authorize(['ADMIN', 'MANAGER']), voidSale);
router.get('/reports/summary', authenticate, authorize(['ADMIN', 'MANAGER']), getSalesReport);
router.get('/reports/trend', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getSalesTrend);
router.get('/voided', authenticate, authorize(['ADMIN', 'MANAGER']), getVoidedSales);

export default router;