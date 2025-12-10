import express from 'express';
import { authenticate, requireRole, validateRequest, logActivity, rateLimit } from '../middleware/auth.js';
import { validationSchemas } from '../middleware/validation.js';
import { AuthController } from '../controllers/auth-controller.js';

const router = express.Router();
const authController = new AuthController();

const authRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many authentication attempts, please try again after an hour',
    keyGenerator: (req) => req.ip || 'unknown'
});

// Public routes (no authentication required)
router.post('/login',
    authRateLimit,
    validateRequest(validationSchemas.login),
    authController.login
);

router.post('/refresh',
    authController.refreshToken
);

router.post('/verify-email',
    authRateLimit,
    validateRequest(validationSchemas.verifyEmail),
    authController.verifyEmail
);

router.post('/forgot-password',
    authRateLimit,
    validateRequest(validationSchemas.forgotPassword),
    authController.forgotPassword
);

router.post('/reset-password',
    authRateLimit,
    validateRequest(validationSchemas.resetPassword),
    authController.resetPassword
);

// Protected routes (authentication required)
router.post('/register',
    authRateLimit,
    authenticate,
    requireRole(['ADMIN']),
    validateRequest(validationSchemas.register),
    logActivity('REGISTER_USER', 'USER'),
    authController.register
);

router.post('/logout',
    authenticate,
    authController.logout
);

router.get('/profile',
    authenticate,
    authController.getProfile
);

router.put('/profile',
    authenticate,
    validateRequest(validationSchemas.updateProfile),
    logActivity('UPDATE_PROFILE', 'USER'),
    authController.updateProfile
);

export default router;