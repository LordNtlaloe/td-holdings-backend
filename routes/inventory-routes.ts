// routes/inventory.routes.ts
import { Router } from 'express';
import {
    getInventory,
    getInventoryById,
    updateInventory,
    getLowStockItems,
    getInventoryHistory,
    bulkInventoryUpdate,
    getInventoryReport
} from '../controllers/inventory-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET endpoints (Read operations)
router.get('/', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getInventory);
router.get('/:id', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getInventoryById);
router.get('/alerts/low-stock', authenticate, authorize(['ADMIN', 'MANAGER']), getLowStockItems);
router.get('/history', authenticate, authorize(['ADMIN', 'MANAGER']), getInventoryHistory);
router.get('/reports/summary', authenticate, authorize(['ADMIN', 'MANAGER']), getInventoryReport);

// PUT endpoints (Update operations)
router.put('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), updateInventory);

// POST endpoints (Create/Bulk operations)
router.post('/bulk-update', authenticate, authorize(['ADMIN', 'MANAGER']), bulkInventoryUpdate);

export default router;