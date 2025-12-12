// routes/auth.routes.ts
import express from 'express';
import {
    authenticate,
    requireRole,
    validateRequest,
    logActivity,
    rateLimit
} from '../middleware/auth';
import { validationSchemas } from '../middleware/validation';
import {
    register,
    login,
    refreshToken,
    logout,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getProfile,
    updateProfile
} from '../controllers/auth-controller';

const router = express.Router();

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
    login
);

router.post('/refresh',
    refreshToken
);

router.post('/verify-email',
    authRateLimit,
    validateRequest(validationSchemas.verifyEmail),
    verifyEmail
);

router.post('/forgot-password',
    authRateLimit,
    validateRequest(validationSchemas.forgotPassword),
    forgotPassword
);

router.post('/reset-password',
    authRateLimit,
    validateRequest(validationSchemas.resetPassword),
    resetPassword
);

// Protected routes (authentication required)
router.post('/register',
    authRateLimit,
    authenticate, // Temporarily disabled for easier testing
    requireRole(['ADMIN']), // Temporarily disabled for easier testing
    validateRequest(validationSchemas.register),
    logActivity('REGISTER_USER', 'USER'),
    register
);

router.post('/logout',
    authenticate,
    logout
);

router.get('/profile',
    authenticate,
    getProfile
);

router.put('/profile',
    authenticate,
    validateRequest(validationSchemas.updateProfile),
    logActivity('UPDATE_PROFILE', 'USER'),
    updateProfile
);

export default router;