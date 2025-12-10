import express from 'express';
import {
    authenticate,
    requireRole,
    requireEmployeeAccess,
    validateRequest,
    logActivity
} from '../middleware/auth.js';
import { validationSchemas } from '../middleware/validation';
import { EmployeeController } from '../controllers/employee-controller';

const router = express.Router();
const employeeController = new EmployeeController();

// GET routes
router.get('/',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    employeeController.getEmployees
);

router.get('/my-data',
    authenticate,
    employeeController.getMyEmployeeData
);

router.get('/:id',
    authenticate,
    requireEmployeeAccess(),
    employeeController.getEmployeeById
);

router.get('/:id/performance',
    authenticate,
    requireEmployeeAccess(),
    employeeController.getEmployeePerformance
);

router.get('/:id/activities',
    authenticate,
    requireEmployeeAccess(),
    employeeController.getEmployeeActivities
);

// POST routes
router.post('/',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    validateRequest(validationSchemas.createEmployee),
    logActivity('CREATE_EMPLOYEE', 'EMPLOYEE'),
    employeeController.createEmployee
);

router.post('/:id/deactivate',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireEmployeeAccess(),
    logActivity('DEACTIVATE_EMPLOYEE', 'EMPLOYEE'),
    employeeController.deactivateEmployee
);

router.post('/:id/reset-password',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireEmployeeAccess(),
    logActivity('RESET_EMPLOYEE_PASSWORD', 'EMPLOYEE'),
    employeeController.resetEmployeePassword
);

// PUT routes
router.put('/:id',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireEmployeeAccess(),
    validateRequest(validationSchemas.updateEmployee),
    logActivity('UPDATE_EMPLOYEE', 'EMPLOYEE'),
    employeeController.updateEmployee
);

// DELETE routes
router.delete('/:id',
    authenticate,
    requireRole(['ADMIN']),
    logActivity('DELETE_EMPLOYEE', 'EMPLOYEE'),
    employeeController.deleteEmployee
);

export default router;