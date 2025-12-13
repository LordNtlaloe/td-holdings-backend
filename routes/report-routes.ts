import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';
import * as posController from '../controllers/sales/pos-controller';
import * as transferController from '../controllers/supply-chain/transfer-controller';
import * as employeeController from '../controllers/work-force/employee-controller';
import * as inventoryController from '../controllers/inventory/stock-controller';
import * as auditController from '../controllers/inventory/audit-controller';
import * as storeController from '../controllers/store-operations/store-controller';

const router = Router();

// All report routes require authentication
router.use(authenticateToken);

// ============ SALES REPORTS ============
router.get('/sales', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('salesReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const period = (req.query.period as 'day' | 'week' | 'month' | 'year') || 'month';
            const storeId = req.query.storeId as string;
            
            const result = await posController.getSalesStatistics(period, storeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ INVENTORY REPORTS ============
router.get('/inventory/movement', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('inventoryReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const storeIds = req.query.storeIds 
                ? (req.query.storeIds as string).split(',') 
                : [];
            const productIds = req.query.productIds 
                ? (req.query.productIds as string).split(',') 
                : [];
            const startDate = new Date(req.query.startDate as string);
            const endDate = new Date(req.query.endDate as string);
            const changeTypes = req.query.changeTypes 
                ? (req.query.changeTypes as string).split(',') as any[]
                : undefined;
            
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

router.get('/inventory/low-stock', 
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

router.get('/inventory/export', 
    requireRole('ADMIN'), 
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const inventoryId = req.query.inventoryId as string;
            const startDate = req.query.startDate 
                ? new Date(req.query.startDate as string) 
                : undefined;
            const endDate = req.query.endDate 
                ? new Date(req.query.endDate as string) 
                : undefined;
            
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

// ============ TRANSFER REPORTS ============
router.get('/transfers', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('transferReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const storeId = req.query.storeId as string;
            const dateFrom = req.query.dateFrom 
                ? new Date(req.query.dateFrom as string) 
                : undefined;
            const dateTo = req.query.dateTo 
                ? new Date(req.query.dateTo as string) 
                : undefined;
            
            const result = await transferController.getTransferStatistics(
                storeId,
                dateFrom,
                dateTo
            );
            
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ EMPLOYEE REPORTS ============
router.get('/employees/performance', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('employeePerformanceReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = req.query.employeeId as string;
            const period = (req.query.period as 'day' | 'week' | 'month' | 'year') || 'month';
            
            const result = await employeeController.getEmployeePerformance(
                employeeId,
                period
            );
            
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

router.get('/employees/store-summary/:storeId', 
    requireRole('ADMIN', 'MANAGER'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { storeId } = req.params;
            const result = await employeeController.getStoreStaffSummary(storeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ STORE REPORTS ============
router.get('/stores/performance/:storeId', 
    requireRole('ADMIN', 'MANAGER'), 
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

router.get('/stores/inventory-summary/:storeId', 
    requireRole('ADMIN', 'MANAGER'), 
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

// ============ VOIDED SALES REPORTS ============
router.get('/voids', 
    requireRole('ADMIN'), 
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // You'll need to import voidController and implement this
            const storeId = req.query.storeId as string;
            const dateFrom = req.query.dateFrom 
                ? new Date(req.query.dateFrom as string) 
                : undefined;
            const dateTo = req.query.dateTo 
                ? new Date(req.query.dateTo as string) 
                : undefined;
            
            // const result = await voidController.getVoidStatistics(storeId, dateFrom, dateTo);
            // res.status(200).json(result);
            
            res.status(501).json({ message: 'Void reports endpoint not yet implemented' });
        } catch (error) {
            next(error);
        }
    }
);

// ============ DASHBOARD REPORTS ============
router.get('/dashboard/summary', 
    requireRole('ADMIN', 'MANAGER'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Combine multiple reports for dashboard
            // You'll need to create a dashboard controller
            const storeId = req.query.storeId as string;
            const period = (req.query.period as 'day' | 'week' | 'month' | 'year') || 'day';
            
            // Example: Fetch multiple reports in parallel
            // const [salesStats, inventoryStats, transferStats] = await Promise.all([
            //     posController.getSalesStatistics(period, storeId),
            //     inventoryController.getStoresNeedingRestock(),
            //     transferController.getTransferStatistics(storeId)
            // ]);
            
            res.status(501).json({ message: 'Dashboard summary endpoint not yet implemented' });
        } catch (error) {
            next(error);
        }
    }
);

export default router;