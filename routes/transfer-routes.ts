import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole, validateStoreAccess } from '../middleware/auth-middleware';
import * as transferController from '../controllers/supply-chain/transfer-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// All transfer routes require authentication
router.use(authenticateToken);

// Initiate transfer
router.post('/',
    requireRole('MANAGER'),
    validate('initiateTransfer'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId, fromStoreId, toStoreId, quantity, reason, notes } = req.body;
            const initiatedBy = (req as any).user?.id;

            const result = await transferController.initiateTransfer(
                productId,
                fromStoreId,
                toStoreId,
                quantity,
                initiatedBy,
                reason,
                notes
            );

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all transfers with filters
router.get('/',
    requireRole('ADMIN', 'MANAGER'),
    validate('transferFilter', 'query'),
    validate('pagination', 'query'),
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const filters = {
                status: req.query.status as any,
                productId: req.query.productId as string,
                fromStoreId: req.query.fromStoreId as string,
                toStoreId: req.query.toStoreId as string,
                dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
                dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
                initiatedBy: req.query.initiatedBy as string
            };

            const result = await transferController.getTransfers(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get transfer details
router.get('/:transferId',
    requireRole('ADMIN', 'MANAGER'),
    // Note: 'transfer' is not in validateEntityExists, so we skip or add it to the validator
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { transferId } = req.params;
            const result = await transferController.getTransferDetails(transferId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Complete transfer
router.post('/:transferId/complete',
    requireRole('MANAGER'),
    validate('completeTransfer'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { transferId } = req.params;
            const completedBy = (req as any).user?.id;

            const result = await transferController.completeTransfer(transferId, completedBy);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Cancel transfer
router.post('/:transferId/cancel',
    requireRole('MANAGER'),
    validate('cancelTransfer'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { transferId } = req.params;
            const { reason } = req.body;
            const cancelledBy = (req as any).user?.id;

            const result = await transferController.cancelTransfer(transferId, cancelledBy, reason);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Reject transfer (admin only)
router.post('/:transferId/reject',
    requireRole('ADMIN'),
    validate('rejectTransfer'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { transferId } = req.params;
            const { reason } = req.body;
            const rejectedBy = (req as any).user?.id;

            const result = await transferController.rejectTransfer(transferId, rejectedBy, reason);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get pending transfers for a store
router.get('/store/:storeId/pending',
    requireRole('MANAGER'),
    validateStoreAccess('storeId'),
    validateEntityExists('store', 'storeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const result = await transferController.getPendingTransfersForStore(storeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get transfer statistics
router.get('/reports/statistics',
    requireRole('ADMIN', 'MANAGER'),
    validate('transferReport', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const storeId = req.query.storeId as string;
            const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
            const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;

            const result = await transferController.getTransferStatistics(storeId, dateFrom, dateTo);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;