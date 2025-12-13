import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';
import * as posController from '../controllers/sales/pos-controller';
import * as voidController from '../controllers/sales/void-sales-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// All sale routes require authentication
router.use(authenticateToken);

// Create sale
router.post('/',
    requireRole('CASHIER', 'MANAGER'),
    validate('createSale'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { employeeId, storeId, items, paymentMethod, customerInfo } = req.body;
            const createdBy = (req as any).user?.id;

            const result = await posController.createSale(
                employeeId,
                storeId,
                items,
                paymentMethod,
                customerInfo,
                createdBy
            );

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all sales with filters
router.get('/',
    requireRole('ADMIN', 'MANAGER', 'CASHIER'),
    validate('salesFilter', 'query'),
    validate('pagination', 'query'),
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const filters = {
                storeId: req.query.storeId as string,
                employeeId: req.query.employeeId as string,
                dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
                dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
                paymentMethod: req.query.paymentMethod as any,
                minTotal: req.query.minTotal ? parseFloat(req.query.minTotal as string) : undefined,
                maxTotal: req.query.maxTotal ? parseFloat(req.query.maxTotal as string) : undefined,
                voided: req.query.voided === 'true' ? true :
                    req.query.voided === 'false' ? false : undefined
            };

            const result = await posController.getSales(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get sale details
router.get('/:saleId',
    requireRole('ADMIN', 'MANAGER', 'CASHIER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { saleId } = req.params;
            const result = await posController.getSaleDetails(saleId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Process return/refund
router.post('/:saleId/return',
    requireRole('MANAGER'),
    validate('processReturn'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { saleId } = req.params;
            const { returnItems, reason } = req.body;
            const processedBy = (req as any).user?.id;

            const result = await posController.processReturn(
                saleId,
                returnItems,
                processedBy,
                reason
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Void sale
router.post('/:saleId/void',
    requireRole('MANAGER'),
    validate('voidSale'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { saleId } = req.params;
            const { reason } = req.body;
            const voidedBy = (req as any).user?.id;

            const result = await voidController.voidSale(saleId, voidedBy, reason);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get sales statistics
router.get('/reports/statistics/:period',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { period } = req.params;
            const storeId = req.query.storeId as string;

            const result = await posController.getSalesStatistics(
                period as 'day' | 'week' | 'month' | 'year',
                storeId
            );

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ VOIDED SALES ROUTES ============

// Get voided sale details
router.get('/voided/:voidedSaleId',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { voidedSaleId } = req.params;
            const result = await voidController.getVoidedSaleDetails(voidedSaleId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all voided sales
router.get('/voided/all',
    requireRole('ADMIN', 'MANAGER'),
    validate('pagination', 'query'),
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const filters = {
                storeId: req.query.storeId as string,
                dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
                dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
                voidedBy: req.query.voidedBy as string,
                reasonContains: req.query.reasonContains as string
            };

            const result = await voidController.getVoidedSales(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get void statistics
router.get('/voided/statistics',
    requireRole('ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const storeId = req.query.storeId as string;
            const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
            const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;

            const result = await voidController.getVoidStatistics(storeId, dateFrom, dateTo);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Validate if sale can be voided
router.get('/:saleId/can-void',
    requireRole('MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { saleId } = req.params;
            const result = await voidController.validateSaleCanBeVoided(saleId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;