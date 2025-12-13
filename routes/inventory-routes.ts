import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole, validateStoreAccess } from '../middleware/auth-middleware';
import * as inventoryController from '../controllers/inventory/stock-controller';
import * as auditController from '../controllers/inventory/audit-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// All inventory routes require authentication
router.use(authenticateToken);

// Allocate initial inventory
router.post('/allocate',
    requireRole('ADMIN', 'MANAGER'),
    validate('allocateInventory'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId, storeId, quantity, storePrice } = req.body;
            const createdBy = (req as any).user?.id;

            const result = await inventoryController.allocateInventory(
                productId,
                storeId,
                quantity,
                createdBy,
                storePrice
            );

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Adjust inventory
router.post('/:inventoryId/adjust',
    requireRole('ADMIN', 'MANAGER'),
    // Note: 'inventory' is not in validateEntityExists, so we'll skip this or add it to the validator
    validate('adjustInventory'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { inventoryId } = req.params;
            const { adjustment, changeType, notes, referenceId } = req.body;
            const createdBy = (req as any).user?.id;

            const result = await inventoryController.adjustInventory(
                inventoryId,
                adjustment,
                changeType,
                createdBy,
                notes,
                referenceId
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Reserve inventory (for pending sales/transfers)
router.post('/reserve',
    requireRole('CASHIER', 'MANAGER'),
    validate('reserveInventory'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId, storeId, quantity, reservationId } = req.body;
            const reservedBy = (req as any).user?.id;

            const result = await inventoryController.reserveInventory(
                productId,
                storeId,
                quantity,
                reservationId,
                reservedBy
            );

            res.status(200).json({ success: result });
        } catch (error) {
            next(error);
        }
    }
);

// Check inventory availability
router.get('/availability/:productId',
    requireRole('CASHIER', 'MANAGER'),
    validateEntityExists('product', 'productId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const quantity = parseInt(req.query.quantity as string) || 1;
            const excludeStoreId = req.query.excludeStoreId as string;

            const result = await inventoryController.checkInventoryAvailability(
                productId,
                quantity,
                excludeStoreId
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get product inventory across all stores
router.get('/product/:productId/across-stores',
    requireRole('ADMIN', 'MANAGER'),
    validateEntityExists('product', 'productId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const result = await inventoryController.getProductInventoryAcrossStores(productId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Set reorder levels
router.put('/:inventoryId/reorder-levels',
    requireRole('ADMIN', 'MANAGER'),
    validate('setReorderLevels'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { inventoryId } = req.params;
            const { reorderLevel, optimalLevel } = req.body;
            const updatedBy = (req as any).user?.id;

            const result = await inventoryController.setReorderLevels(
                inventoryId,
                reorderLevel,
                optimalLevel,
                updatedBy
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get stores needing restock
router.get('/reports/needs-restock',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await inventoryController.getStoresNeedingRestock();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Receive shipment (bulk update)
router.post('/receive-shipment',
    requireRole('ADMIN', 'MANAGER'),
    validate('receiveShipment'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { updates, shipmentId } = req.body;
            const receivedBy = (req as any).user?.id;

            const result = await inventoryController.receiveShipment(
                updates,
                shipmentId,
                receivedBy
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ INVENTORY AUDIT ROUTES ============

// Get inventory history
router.get('/:inventoryId/history',
    requireRole('ADMIN', 'MANAGER'),
    validate('dateRange', 'query'),
    validate('pagination', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { inventoryId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
            const changeTypes = req.query.changeTypes ?
                (Array.isArray(req.query.changeTypes) ? req.query.changeTypes : [req.query.changeTypes]) as any[] :
                undefined;

            const result = await auditController.getInventoryHistory(
                inventoryId,
                page,
                limit,
                startDate,
                endDate,
                changeTypes
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get inventory change summary
router.get('/:inventoryId/summary',
    requireRole('ADMIN', 'MANAGER'),
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { inventoryId } = req.params;
            const startDate = new Date(req.query.startDate as string);
            const endDate = new Date(req.query.endDate as string);

            const result = await auditController.getInventoryChangeSummary(
                inventoryId,
                startDate,
                endDate
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get stock movement report
router.get('/reports/movement',
    requireRole('ADMIN', 'MANAGER'),
    validate('inventoryReport', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const storeIds = req.query.storeIds ?
                (Array.isArray(req.query.storeIds) ? req.query.storeIds : [req.query.storeIds]) as string[] :
                [];
            const productIds = req.query.productIds ?
                (Array.isArray(req.query.productIds) ? req.query.productIds : [req.query.productIds]) as string[] :
                [];
            const startDate = new Date(req.query.startDate as string);
            const endDate = new Date(req.query.endDate as string);
            const changeTypes = req.query.changeTypes ?
                (Array.isArray(req.query.changeTypes) ? req.query.changeTypes : [req.query.changeTypes]) as any[] :
                undefined;

            const result = await auditController.getStockMovementReport(
                storeIds,
                productIds,
                startDate,
                endDate,
                changeTypes
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get audit trail by reference
router.get('/audit/reference/:referenceId',
    requireRole('ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { referenceId } = req.params;
            const referenceType = req.query.referenceType as string;

            const result = await auditController.getAuditTrailByReference(
                referenceId,
                referenceType
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Export inventory history
router.get('/export/history',
    requireRole('ADMIN'),
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const inventoryId = req.query.inventoryId as string;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const result = await auditController.exportInventoryHistory(
                inventoryId,
                startDate,
                endDate
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Validate inventory integrity
router.get('/validate/integrity',
    requireRole('ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await auditController.validateInventoryIntegrity();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;