// routes/product.routes.ts
import { Router } from 'express';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductStockAnalysis,
  bulkUpdateProducts,
  searchProducts,
  getLowStockProducts,
  getProductAttributes,
  getProductPriceStatistics,
  getProductStatisticsByCategory,
  getProductAvailability,
  getProductsByStore,
  getProductsWithInventory
} from '../controllers/product-controller';
import { authenticate, authorize, authorizeStoreAccess } from '../middleware/auth';

const router = Router();

// Public/Read endpoints - Available to all authenticated users
router.get('/search', authenticate, searchProducts);
router.get('/attributes', getProductAttributes);
router.get('/reports/low-stock', authenticate, getLowStockProducts);
router.get('/statistics/categories', authenticate, getProductStatisticsByCategory);
router.get('/statistics/prices', authenticate, getProductPriceStatistics);
router.get('/inventory/summary', authenticate, getProductsWithInventory);

// Parameterized routes AFTER
router.get('/', authenticate, getProducts);
router.get('/store/:storeId', authenticate, authorizeStoreAccess, getProductsByStore);
router.get('/:id', authenticate, getProductById);
router.get('/:id/stock-analysis', authenticate, getProductStockAnalysis);
router.get('/:productId/availability', authenticate, getProductAvailability);

// Write operations
router.post('/', authenticate, authorize(['ADMIN', 'MANAGER']), createProduct);
router.post('/bulk-update', authenticate, authorize(['ADMIN']), bulkUpdateProducts);
router.put('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), updateProduct);
router.delete('/:id', authenticate, authorize(['ADMIN']), deleteProduct);

export default router;