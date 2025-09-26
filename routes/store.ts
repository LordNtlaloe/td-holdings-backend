import express from "express";
import {
    authenticateToken, requireAdmin, requireManagerOrAdmin,
    requireEmployee, sanitizeInput, validateRequiredFields,
    validateStoreOwnership
} from "../middleware/auth";

import {
    createStore, getStores, getStoreById,
    updateStore, deleteStore, getStoreAnalytics, getStoresSummary
} from "../controllers/store-controller";

const router = express.Router();

// ============ STORE ROUTES ============
router.post('/',
    authenticateToken,
    requireAdmin,
    sanitizeInput,
    validateRequiredFields(['name', 'location']),
    createStore
);

router.get('/',
    authenticateToken,
    requireEmployee,
    getStores
);

router.get('/summary',
    authenticateToken,
    requireManagerOrAdmin,
    getStoresSummary
);

router.get('/:id',
    authenticateToken,
    requireEmployee,
    validateStoreOwnership,
    getStoreById
);

router.put('/:id',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateStoreOwnership,
    updateStore
);

router.delete('/:id',
    authenticateToken,
    requireAdmin,
    deleteStore
);

router.get('/:id/analytics',
    authenticateToken,
    requireManagerOrAdmin,
    validateStoreOwnership,
    getStoreAnalytics
);

export default router;
