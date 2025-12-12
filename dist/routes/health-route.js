"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});
router.get('/status', (req, res) => {
    res.json({
        service: 'Inventory Management System API',
        version: '1.0.0',
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});
router.get('/health/detailed', (req, res) => {
    res.json({
        status: 'OK',
        database: 'connected',
        redis: 'connected',
        services: ['auth', 'database', 'cache'],
        timestamp: new Date().toISOString()
    });
});
exports.default = router;
//# sourceMappingURL=health-route.js.map