"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const employee_controller_1 = require("../controllers/employee-controller");
const router = express_1.default.Router();
const employeeController = new employee_controller_1.EmployeeController();
router.get('/', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), employeeController.getEmployees);
router.get('/my-data', auth_1.authenticate, employeeController.getMyEmployeeData);
router.get('/:id', auth_1.authenticate, (0, auth_1.requireEmployeeAccess)(), employeeController.getEmployeeById);
router.get('/:id/performance', auth_1.authenticate, (0, auth_1.requireEmployeeAccess)(), employeeController.getEmployeePerformance);
router.get('/:id/activities', auth_1.authenticate, (0, auth_1.requireEmployeeAccess)(), employeeController.getEmployeeActivities);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.createEmployee), (0, auth_1.logActivity)('CREATE_EMPLOYEE', 'EMPLOYEE'), employeeController.createEmployee);
router.post('/:id/deactivate', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireEmployeeAccess)(), (0, auth_1.logActivity)('DEACTIVATE_EMPLOYEE', 'EMPLOYEE'), employeeController.deactivateEmployee);
router.post('/:id/reset-password', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireEmployeeAccess)(), (0, auth_1.logActivity)('RESET_EMPLOYEE_PASSWORD', 'EMPLOYEE'), employeeController.resetEmployeePassword);
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireEmployeeAccess)(), (0, auth_1.validateRequest)(validation_1.validationSchemas.updateEmployee), (0, auth_1.logActivity)('UPDATE_EMPLOYEE', 'EMPLOYEE'), employeeController.updateEmployee);
router.delete('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN']), (0, auth_1.logActivity)('DELETE_EMPLOYEE', 'EMPLOYEE'), employeeController.deleteEmployee);
exports.default = router;
//# sourceMappingURL=employees-routes.js.map