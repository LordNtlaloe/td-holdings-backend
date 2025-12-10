import express from 'express';
import {
    authenticate,
    requireRole,
    requireStoreAccess,
    validateRequest,
    logActivity
} from '../middleware/auth';
import { validationSchemas } from '../middleware/validation';
import { StoreController } from '../controllers/store-controller';

const router = express.Router();
const storeController = new StoreController();

// GET routes
router.get('/',
    authenticate,
    storeController.getStores
);

router.get('/:id',
    authenticate,
    requireStoreAccess({ allowAdmin: true }),
    storeController.getStoreById
);

router.get('/:id/stats',
    authenticate,
    requireStoreAccess({ allowAdmin: true }),
    storeController.getStoreStats
);

router.get('/:id/employees',
    authenticate,
    requireStoreAccess({ allowAdmin: true }),
    storeController.getStoreEmployees
);

// POST routes
router.post('/',
    authenticate,
    requireRole(['ADMIN']),
    validateRequest(validationSchemas.createStore),
    logActivity('CREATE_STORE', 'STORE'),
    storeController.createStore
);

router.post('/:id/employees',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireStoreAccess({ allowAdmin: true }),
    logActivity('ADD_STORE_EMPLOYEE', 'STORE'),
    storeController.addEmployeeToStore
);

// PUT routes
router.put('/:id',
    authenticate,
    requireRole(['ADMIN']),
    validateRequest(validationSchemas.updateStore),
    logActivity('UPDATE_STORE', 'STORE'),
    storeController.updateStore
);

// DELETE routes
router.delete('/:id',
    authenticate,
    requireRole(['ADMIN']),
    logActivity('DELETE_STORE', 'STORE'),
    storeController.deleteStore
);

router.delete('/:id/employees/:employeeId',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireStoreAccess({ allowAdmin: true }),
    logActivity('REMOVE_STORE_EMPLOYEE', 'STORE'),
    storeController.removeEmployeeFromStore
);

export default router;