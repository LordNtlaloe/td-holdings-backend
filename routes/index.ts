import express from 'express';
import activityRoutes from "./activity-routes"
import analyticsRoutes from "./analytics-routes"
import authRoutes from "./auth-routes"
import employeeRoutes from "./employees-routes"
import productRoutes from "./product-routes"
import salesRoutes from "./sales-routes"
import storeRoutes from "./store-routes"
import statRoutes from "./stats-routes"
import dashboardRoutes from "./dashboard-routes"

import reportRoutes from "./report-routes"
import healthRoutes from "./health-route"

const router = express.Router();

// Register all route modules
router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/products', productRoutes);
router.use('/sales', salesRoutes);
router.use('/stores', storeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/activities', activityRoutes);
router.use('/reports', reportRoutes);
router.use('/stats', statRoutes)
router.use('/analytics', analyticsRoutes)
router.use('/', healthRoutes); // Health routes at root level

export default router;