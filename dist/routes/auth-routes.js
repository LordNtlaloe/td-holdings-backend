"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const auth_controller_1 = require("../controllers/auth-controller");
const router = express_1.default.Router();
const authRateLimit = (0, auth_1.rateLimit)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many authentication attempts, please try again after an hour',
    keyGenerator: (req) => req.ip || 'unknown'
});
router.post('/login', authRateLimit, (0, auth_1.validateRequest)(validation_1.validationSchemas.login), auth_controller_1.login);
router.post('/refresh', auth_controller_1.refreshToken);
router.post('/verify-email', authRateLimit, (0, auth_1.validateRequest)(validation_1.validationSchemas.verifyEmail), auth_controller_1.verifyEmail);
router.post('/forgot-password', authRateLimit, (0, auth_1.validateRequest)(validation_1.validationSchemas.forgotPassword), auth_controller_1.forgotPassword);
router.post('/reset-password', authRateLimit, (0, auth_1.validateRequest)(validation_1.validationSchemas.resetPassword), auth_controller_1.resetPassword);
router.post('/register', authRateLimit, (0, auth_1.validateRequest)(validation_1.validationSchemas.register), (0, auth_1.logActivity)('REGISTER_USER', 'USER'), auth_controller_1.register);
router.post('/logout', auth_1.authenticate, auth_controller_1.logout);
router.get('/profile', auth_1.authenticate, auth_controller_1.getProfile);
router.put('/profile', auth_1.authenticate, (0, auth_1.validateRequest)(validation_1.validationSchemas.updateProfile), (0, auth_1.logActivity)('UPDATE_PROFILE', 'USER'), auth_controller_1.updateProfile);
exports.default = router;
//# sourceMappingURL=auth-routes.js.map