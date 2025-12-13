import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole, validateStoreAccess } from '../middleware/auth-middleware';
import * as employeeController from '../controllers/work-force/employee-controller';
import { validateEntityExists } from '../middleware/custom-validators';

const router = Router();

// All employee routes require authentication
router.use(authenticateToken);

// Create employee (admin/manager only)
router.post('/', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('createEmployee'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId, storeId, position, role } = req.body;
            const createdBy = (req as any).user?.id;
            
            const result = await employeeController.createEmployee(
                userId,
                storeId,
                position,
                role,
                createdBy
            );
            
            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get all employees with filters
router.get('/', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    validate('employeeFilter', 'query'), 
    validate('pagination', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            
            const filters = {
                storeId: req.query.storeId as string,
                role: req.query.role as any,
                position: req.query.position as string,
                search: req.query.search as string,
                activeOnly: req.query.activeOnly === 'true'
            };
            
            const result = await employeeController.getEmployees(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get employee details
router.get('/:employeeId', 
    requireRole('ADMIN', 'MANAGER', 'CASHIER'), 
    validateEntityExists('employee', 'employeeId'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { employeeId } = req.params;
            const result = await employeeController.getEmployeeDetails(employeeId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Update employee
router.put('/:employeeId', 
    requireRole('ADMIN', 'MANAGER'), 
    validateEntityExists('employee', 'employeeId'),
    validate('updateEmployee'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { employeeId } = req.params;
            const updates = req.body;
            const updatedBy = (req as any).user?.id;
            
            const result = await employeeController.updateEmployee(
                employeeId,
                updates,
                updatedBy
            );
            
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Transfer employee to another store
router.post('/:employeeId/transfer', 
    requireRole('ADMIN', 'MANAGER'), 
    validateEntityExists('employee', 'employeeId'),
    validate('transferEmployee'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { employeeId } = req.params;
            const { newStoreId, reason } = req.body;
            const transferredBy = (req as any).user?.id;
            
            const result = await employeeController.transferEmployee(
                employeeId,
                newStoreId,
                transferredBy,
                reason
            );
            
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get employee performance report
router.get('/:employeeId/performance', 
    requireRole('ADMIN', 'MANAGER'), 
    validateEntityExists('employee', 'employeeId'),
    validate('employeePerformanceReport', 'query'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { employeeId } = req.params;
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

// Get store staff summary
router.get('/store/:storeId/summary', 
    authenticateToken, 
    validateStoreAccess('storeId'),
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

export default router;