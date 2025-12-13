import { Router } from 'express';
import authRoutes from './auth-routes';
import userRoutes from './users-route';
import employeeRoutes from './employees-routes';
import storeRoutes from './store-routes';
import productRoutes from './product-routes';
import inventoryRoutes from './inventory-routes';
import transferRoutes from './transfer-routes';
import saleRoutes from './sales-routes';
import reportRoutes from './report-routes';
import auditRoutes from './audit-routes';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'inventory-management-api'
    });
});

// API version prefix
const apiPrefix = '/v1';

// Mount all routes
router.use(`${apiPrefix}/auth`, authRoutes);
router.use(`${apiPrefix}/users`, userRoutes);
router.use(`${apiPrefix}/employees`, employeeRoutes);
router.use(`${apiPrefix}/stores`, storeRoutes);
router.use(`${apiPrefix}/products`, productRoutes);
router.use(`${apiPrefix}/inventory`, inventoryRoutes);
router.use(`${apiPrefix}/transfers`, transferRoutes);
router.use(`${apiPrefix}/sales`, saleRoutes);
router.use(`${apiPrefix}/reports`, reportRoutes);
router.use(`${apiPrefix}/audit`, auditRoutes);

// 404 handler - use .use() without path or .all('*')
router.use((req, res) => {
    res.status(404).json({
        error: 'ROUTE_NOT_FOUND',
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
    });
});

export default router;