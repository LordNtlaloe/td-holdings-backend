import express from "express";
import {
    authenticateToken, requireManagerOrAdmin, requireEmployee,
    requireStoreAccess, sanitizeInput, validateRequiredFields
} from "../middleware/auth";

import {
    createProduct, getProducts, getProductById, updateProduct,
    deleteProduct, updateProductQuantity, getLowStockProducts,
    getProductAnalytics, bulkUpdateProducts
} from "../controllers/product-controller";

const router = express.Router();

// ============ PRODUCT ROUTES ============
router.post('/',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateRequiredFields(['name', 'price', 'quantity', 'type', 'grade', 'storeId']),
    requireStoreAccess(),
    createProduct
);

router.get('/',
    authenticateToken,
    requireEmployee,
    requireStoreAccess(false),
    getProducts
);

router.get('/low-stock',
    authenticateToken,
    requireManagerOrAdmin,
    requireStoreAccess(false),
    getLowStockProducts
);

router.get('/analytics',
    authenticateToken,
    requireManagerOrAdmin,
    requireStoreAccess(false),
    getProductAnalytics
);

router.get('/:id',
    authenticateToken,
    requireEmployee,
    getProductById
);

router.put('/:id',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    updateProduct
);

router.patch('/:id/quantity',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateRequiredFields(['quantity', 'operation']),
    updateProductQuantity
);

router.put('/bulk',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateRequiredFields(['productIds', 'updates']),
    bulkUpdateProducts
);

router.delete('/:id',
    authenticateToken,
    requireManagerOrAdmin,
    deleteProduct
);

export default router;
