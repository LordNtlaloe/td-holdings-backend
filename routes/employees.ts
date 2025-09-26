import express from "express";
import {
    authenticateToken, requireManagerOrAdmin, requireEmployee,
    requireStoreAccess, requireEmployeeAccess, sanitizeInput, validateRequiredFields
} from "../middleware/auth";

import {
    createEmployee, getEmployees, getEmployeeById,
    updateEmployee, deleteEmployee, getEmployeeSalesPerformance
} from "../controllers/employee-controller";

const router = express.Router();

// ============ EMPLOYEE ROUTES ============
router.post('/',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    validateRequiredFields(['firstName', 'lastName', 'phone', 'email', 'password', 'role', 'storeId']),
    requireStoreAccess(),
    createEmployee
);

router.get('/',
    authenticateToken,
    requireEmployee,
    requireStoreAccess(false),
    getEmployees
);

router.get('/:id',
    authenticateToken,
    requireEmployee,
    requireEmployeeAccess,
    getEmployeeById
);

router.put('/:id',
    authenticateToken,
    requireManagerOrAdmin,
    sanitizeInput,
    requireEmployeeAccess,
    updateEmployee
);

router.delete('/:id',
    authenticateToken,
    requireManagerOrAdmin,
    requireEmployeeAccess,
    deleteEmployee
);

router.get('/:id/performance',
    authenticateToken,
    requireEmployee,
    requireEmployeeAccess,
    getEmployeeSalesPerformance
);

export default router;
