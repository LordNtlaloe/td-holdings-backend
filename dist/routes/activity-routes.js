"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const activity_controller_1 = require("../controllers/activity-controller");
const router = express_1.default.Router();
const activityController = new activity_controller_1.ActivityController();
router.get('/', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), activityController.getActivityLogs);
router.get('/summary', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), activityController.getActivitySummary);
exports.default = router;
//# sourceMappingURL=activity-routes.js.map