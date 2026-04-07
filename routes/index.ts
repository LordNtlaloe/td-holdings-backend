// routes/index.ts
import { Router } from 'express';
import authRoutes from './auth-routes';
import dashboardRoutes from './dashboard-routes';
import employeeRoutes from "./employee-routes"
import inventoryRoutes from "./inventory-routes"
import productRoutes from "./product-routes"
import salesRoutes from './sales-routes';
import storeRoutes from "./stores-routes"
import transferRoutes from './transfer-routes';
import salesDashboard from './sales-dasboard-routes'

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API routes
router.use('/auth', authRoutes);
router.use('/sales', salesRoutes);
router.use('/transfers', transferRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/employees', employeeRoutes)
router.use('/inventory', inventoryRoutes);
router.use('/products', productRoutes)
router.use('/stores', storeRoutes)
router.use('/sales-dashboard', salesDashboard)


export default router;