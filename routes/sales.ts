import express from "express";
import {
    authenticateToken, requireManagerOrAdmin, requireEmployee,
    requireStoreAccess, sanitizeInput, validateRequiredFields
} from "../middleware/auth";

import {
    createSale, getSales, getSaleById,
    getSalesAnalytics, voidSale, getDailySalesReport
} from "../controllers/sales-controller";

const router = express.Router();

// ============ SALES ROUTES ============
router.post('/',
    authenticateToken,
    requireEmployee,
    sanitizeInput,
    validateRequiredFields(['employeeId', 'storeId', 'items']),
    requireStoreAccess(),
    createSale
);

router.get('/',
    authenticateToken,
    requireEmployee,
    requireStoreAccess(false),
    getSales
);

router.get('/analytics',
    authenticateToken,
    requireManagerOrAdmin,
    requireStoreAccess(false),
    getSalesAnalytics
);

router.get('/daily-report',
    authenticateToken,
    requireManagerOrAdmin,
    requireStoreAccess(false),
    getDailySalesReport
);

router.get('/:id',
    authenticateToken,
    requireEmployee,
    getSaleById
);

router.delete('/:id/void',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateRequiredFields(['reason']),
    voidSale
);

export default router;
