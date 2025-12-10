import express from 'express';
import {
    authenticate,
    requireRole,
    requireProductAccess,
    validateRequest,
    logActivity
} from '../middleware/auth.js';
import { validationSchemas } from '../middleware/validation.js';
import { ProductController } from '../controllers/product-controller.js';

const router = express.Router();
const productController = new ProductController();

// GET routes
router.get('/',
    authenticate,
    productController.getProducts
);

router.get('/low-stock',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    productController.getLowStock
);

router.get('/:id',
    authenticate,
    requireProductAccess(),
    productController.getProductById
);

// POST routes
router.post('/',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.createProduct),
    logActivity('CREATE_PRODUCT', 'PRODUCT'),
    productController.createProduct
);

router.post('/transfer',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.transferProduct),
    logActivity('TRANSFER_PRODUCT', 'PRODUCT'),
    productController.transferProduct
);

// PUT routes
router.put('/:id',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireProductAccess(),
    validateRequest(validationSchemas.updateProduct),
    logActivity('UPDATE_PRODUCT', 'PRODUCT'),
    productController.updateProduct
);

// PATCH routes
router.patch('/:id/quantity',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireProductAccess(),
    validateRequest(validationSchemas.updateQuantity),
    logActivity('UPDATE_PRODUCT_QUANTITY', 'PRODUCT'),
    productController.updateQuantity
);

// DELETE routes
router.delete('/:id',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireProductAccess(),
    logActivity('DELETE_PRODUCT', 'PRODUCT'),
    productController.deleteProduct
);

export default router;