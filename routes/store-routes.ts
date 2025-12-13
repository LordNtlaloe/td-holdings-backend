import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';
import * as storeController from '../controllers/store-operations/store-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// Public store info (no auth required for basic info)
router.get('/public', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        
        const filters = {
            isMainStore: req.query.isMainStore === 'true',
            search: req.query.search as string
        };
        
        const result = await storeController.getStores(filters, page, limit);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// All other routes require authentication
router.use(authenticateToken);

// Create store (admin only)
router.post('/', 
    requireRole('ADMIN'), 
    validate('createStore'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { name, location, phone, email, isMainStore } = req.body;
            const createdBy = (req as any).user?.id;
            
            const result = await storeController.createStore(
                name,
                location,
                phone,
                email,
                isMainStore,
                createdBy
            );
            
            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all stores
router.get('/', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    validate('pagination', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            
            const filters = {
                isMainStore: req.query.isMainStore === 'true' ? true : 
                            req.query.isMainStore === 'false' ? false : undefined,
                search: req.query.search as string
            };
            
            const result = await storeController.getStores(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get store details
router.get('/:storeId', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    validateEntityExists('store', 'storeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const result = await storeController.getStoreDetails(storeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Update store
router.put('/:storeId', 
    requireRole('ADMIN'), 
    validateEntityExists('store', 'storeId'),
    validate('updateStore'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const updates = req.body;
            const updatedBy = (req as any).user?.id;
            
            const result = await storeController.updateStore(
                storeId,
                updates,
                updatedBy
            );
            
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Set as main store (admin only)
router.post('/:storeId/set-main', 
    requireRole('ADMIN'), 
    validateEntityExists('store', 'storeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const setBy = (req as any).user?.id;
            
            const result = await storeController.setMainStore(storeId, setBy);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get main store
router.get('/main/store', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await storeController.getMainStore();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get store inventory summary
router.get('/:storeId/inventory-summary', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    validateEntityExists('store', 'storeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const result = await storeController.getStoreInventorySummary(storeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get store performance metrics
router.get('/:storeId/performance', 
    requireRole('ADMIN', 'MANAGER'), 
    validateEntityExists('store', 'storeId'),
    validate('storePerformanceReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const period = (req.query.period as 'day' | 'week' | 'month' | 'year') || 'month';
            
            const result = await storeController.getStorePerformance(storeId, period);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;