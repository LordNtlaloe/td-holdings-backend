import { Router } from 'express';
import {
    getStores,
    getStoreById,
    createStore,
    updateStore,
    deleteStore,
    getStoreMetrics,
    getStoreInventory,
    getStoreSalesTrend
} from '../controllers/store-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Public routes (if needed)
// router.get('/stores', getStores);
// router.get('/stores/:id', getStoreById);

// Protected routes
router.get('/', getStores);
router.get('/:id', authenticate, getStoreById);
router.post('/', authenticate, authorize(['ADMIN', 'MANAGER']), createStore);
router.put('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), updateStore);
router.delete('/:id', authenticate, authorize(['ADMIN']), deleteStore);

// Store metrics and analytics
router.get('/:id/metrics', authenticate, getStoreMetrics);
router.get('/:id/inventory', authenticate, getStoreInventory);
router.get('/:id/sales-trend', authenticate, getStoreSalesTrend);

export default router;