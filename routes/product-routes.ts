import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole, validateStoreAccess } from '../middleware/auth-middleware';
import * as productController from '../controllers/catalogue/product-controller';
import * as attributeController from '../controllers/catalogue/attribute-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// Public product info (no auth required for browsing)
router.get('/public/catalog', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;

        const filters = {
            name: req.query.name as string,
            type: req.query.type as any,
            grade: req.query.grade as any,
            commodity: req.query.commodity as string,
            tireCategory: req.query.tireCategory as any,
            tireUsage: req.query.tireUsage as any,
            minPrice: req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined,
            maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined,
            inStock: req.query.inStock === 'true',
            storeId: req.query.storeId as string
        };

        const result = await productController.searchProducts(filters, page, limit);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/public/attributes', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await attributeController.getAllProductAttributes();
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// All other routes require authentication
router.use(authenticateToken);

// Create product (admin/manager only)
router.post('/',
    requireRole('ADMIN', 'MANAGER'),
    validate('createProduct'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const {
                name,
                basePrice,
                type,
                grade,
                commodity,
                tireSpecific,
                baleSpecific,
                storeAssignments
            } = req.body;
            const createdBy = (req as any).user?.id;

            const result = await productController.createProduct(
                name,
                basePrice,
                type,
                grade,
                createdBy,
                commodity,
                tireSpecific,
                baleSpecific,
                storeAssignments
            );

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all products with filters
router.get('/',
    requireRole('ADMIN', 'MANAGER', 'CASHIER'),
    validate('productSearch', 'query'),
    validate('pagination', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const filters = {
                name: req.query.name as string,
                type: req.query.type as any,
                grade: req.query.grade as any,
                commodity: req.query.commodity as string,
                tireCategory: req.query.tireCategory as any,
                tireUsage: req.query.tireUsage as any,
                minPrice: req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined,
                maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined,
                inStock: req.query.inStock === 'true',
                storeId: req.query.storeId as string
            };

            const result = await productController.searchProducts(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get product details
router.get('/:productId',
    requireRole('ADMIN', 'MANAGER', 'CASHIER'),
    validateEntityExists('product', 'productId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const result = await productController.getProductWithInventory(productId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Update product
router.put('/:productId',
    requireRole('ADMIN', 'MANAGER'),
    validateEntityExists('product', 'productId'),
    validate('updateProduct'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const updates = req.body;
            const updatedBy = (req as any).user?.id;

            const result = await productController.updateProduct(
                productId,
                updates,
                updatedBy
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Archive product (soft delete)
router.delete('/:productId',
    requireRole('ADMIN'),
    validateEntityExists('product', 'productId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const { reason } = req.body;
            const archivedBy = (req as any).user?.id;

            await productController.archiveProduct(productId, archivedBy, reason);
            res.status(200).json({ message: 'Product archived successfully' });
        } catch (error) {
            next(error);
        }
    }
);

// Assign product to stores
router.post('/:productId/assign-stores',
    requireRole('ADMIN', 'MANAGER'),
    validateEntityExists('product', 'productId'),
    validate('assignProductToStores'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const { storeIds, initialQuantities } = req.body;
            const assignedBy = (req as any).user?.id;

            const result = await productController.assignProductToStores(
                productId,
                storeIds,
                initialQuantities,
                assignedBy
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Remove product from store
router.delete('/:productId/stores/:storeId',
    requireRole('ADMIN', 'MANAGER'),
    validateEntityExists('product', 'productId'),
    validateEntityExists('store', 'storeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId, storeId } = req.params;
            const removedBy = (req as any).user?.id;

            await productController.removeProductFromStore(
                productId,
                storeId,
                removedBy
            );

            res.status(200).json({ message: 'Product removed from store successfully' });
        } catch (error) {
            next(error);
        }
    }
);

// Get low stock products
router.get('/reports/low-stock',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const threshold = req.query.threshold ? parseInt(req.query.threshold as string) : 10;
            const result = await productController.getLowStockProducts(threshold);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Product attributes and statistics
router.get('/attributes/all',
    requireRole('ADMIN', 'MANAGER', 'CASHIER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await attributeController.getAllProductAttributes();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

router.get('/statistics/categories',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const groupBy = (req.query.groupBy as 'type' | 'grade' | 'tireCategory' | 'tireUsage') || 'type';
            const result = await attributeController.getProductStatistics(groupBy);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);


router.get('/statistics/prices',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await attributeController.getPriceStatistics();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;