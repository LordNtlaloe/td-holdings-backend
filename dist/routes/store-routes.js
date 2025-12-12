"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const store_controller_1 = require("../controllers/store-controller");
const router = express_1.default.Router();
const storeController = new store_controller_1.StoreController();
router.get('/', auth_1.authenticate, storeController.getStores);
router.get('/:id', auth_1.authenticate, (0, auth_1.requireStoreAccess)({ allowAdmin: true }), storeController.getStoreById);
router.get('/:id/stats', auth_1.authenticate, (0, auth_1.requireStoreAccess)({ allowAdmin: true }), storeController.getStoreStats);
router.get('/:id/employees', auth_1.authenticate, (0, auth_1.requireStoreAccess)({ allowAdmin: true }), storeController.getStoreEmployees);
router.post('/', (0, auth_1.validateRequest)(validation_1.validationSchemas.createStore), (0, auth_1.logActivity)('CREATE_STORE', 'STORE'), storeController.createStore);
router.post('/:id/employees', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireStoreAccess)({ allowAdmin: true }), (0, auth_1.logActivity)('ADD_STORE_EMPLOYEE', 'STORE'), storeController.addEmployeeToStore);
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN']), (0, auth_1.validateRequest)(validation_1.validationSchemas.updateStore), (0, auth_1.logActivity)('UPDATE_STORE', 'STORE'), storeController.updateStore);
router.delete('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN']), (0, auth_1.logActivity)('DELETE_STORE', 'STORE'), storeController.deleteStore);
router.delete('/:id/employees/:employeeId', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireStoreAccess)({ allowAdmin: true }), (0, auth_1.logActivity)('REMOVE_STORE_EMPLOYEE', 'STORE'), storeController.removeEmployeeFromStore);
exports.default = router;
//# sourceMappingURL=store-routes.js.map