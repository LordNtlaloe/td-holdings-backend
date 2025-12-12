"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const dashboard_controller_1 = require("../controllers/dashboard-controller");
const router = express_1.default.Router();
const dashboardController = new dashboard_controller_1.DashboardController();
router.get('/', auth_1.authenticate, dashboardController.getDashboardData);
router.get('/sales-chart', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), dashboardController.getSalesChartData);
router.get('/inventory-chart', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), dashboardController.getInventoryChartData);
router.get('/employee-performance', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), dashboardController.getEmployeePerformance);
exports.default = router;
//# sourceMappingURL=dashboard-routes.js.map