import express from "express";
import { sanitizeInput, validateRequiredFields, rateLimit } from "../middleware/auth";
import { register, verify, login, requestPasswordReset, resetPassword } from "../controllers/auth-controller";

const router = express.Router();

// ============ AUTH ROUTES ============
router.post('/register',
    rateLimit(5, 15 * 60 * 1000),
    sanitizeInput,
    validateRequiredFields(['email', 'password']),
    register
);

router.post('/verify',
    rateLimit(10, 15 * 60 * 1000),
    sanitizeInput,
    validateRequiredFields(['email', 'code']),
    verify
);

router.post('/login',
    rateLimit(10, 15 * 60 * 1000),
    sanitizeInput,
    validateRequiredFields(['email', 'password']),
    login
);

router.post('/password-reset/request',
    rateLimit(3, 15 * 60 * 1000),
    sanitizeInput,
    validateRequiredFields(['email']),
    requestPasswordReset
);

router.post('/password-reset/confirm',
    rateLimit(5, 15 * 60 * 1000),
    sanitizeInput,
    validateRequiredFields(['email', 'token', 'newPassword']),
    resetPassword
);

export default router;
