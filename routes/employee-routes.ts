// routes/employee.routes.ts
import { Router } from 'express';
import {
    getEmployees,
    getEmployeeById,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    getEmployeePerformance,
    createPerformanceReview,
    getEmployeeTransfers,
    getEmployeeStats,  // Add this import
    getEmployeeByUserId
} from '../controllers/employee-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Collection routes
router.get('/', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployees);
router.post('/', authenticate, authorize(['ADMIN', 'MANAGER']), createEmployee);

// Stats route - MUST be before /:id route to avoid conflict
router.get('/stats/overview', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployeeStats);
router.get('/users/:userId', authenticate, authorize(['ADMIN', 'MANAGER', 'CASHIER']), getEmployeeByUserId);


// Individual employee routes
router.get('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployeeById);
router.put('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), updateEmployee);
router.delete('/:id', authenticate, authorize(['ADMIN']), deleteEmployee);

// Employee performance routes
router.get('/:id/performance', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployeePerformance);

// Performance review routes
router.post('/:id/reviews', authenticate, authorize(['ADMIN', 'MANAGER']), createPerformanceReview);

// Employee transfer history
router.get('/:id/transfers', authenticate, authorize(['ADMIN', 'MANAGER']), getEmployeeTransfers);

export default router;