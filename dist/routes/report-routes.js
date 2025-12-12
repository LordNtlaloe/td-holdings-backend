"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const report_controller_1 = require("../controllers/report-controller");
const router = express_1.default.Router();
const reportController = new report_controller_1.ReportController();
router.get('/sales', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.salesReport), reportController.generateSalesReport);
router.get('/inventory', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.inventoryReport), reportController.generateInventoryReport);
router.get('/employees', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.employeeReport), reportController.generateEmployeeReport);
exports.default = router;
//# sourceMappingURL=report-routes.js.map