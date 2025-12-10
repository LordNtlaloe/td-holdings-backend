import express from 'express';
import { authenticate, requireRole, validateRequest } from '../middleware/auth.js';
import { validationSchemas } from '../middleware/validation.js';
import { ReportController } from '../controllers/report-controller.js';

const router = express.Router();
const reportController = new ReportController();

// All report routes require manager/admin roles
router.get('/sales',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.salesReport),
    reportController.generateSalesReport
);

router.get('/inventory',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.inventoryReport),
    reportController.generateInventoryReport
);

router.get('/employees',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.employeeReport),
    reportController.generateEmployeeReport
);

export default router;