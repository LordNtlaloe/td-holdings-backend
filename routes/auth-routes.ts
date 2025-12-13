import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import * as authController from '../controllers/auth/auth-controller';
import * as tokenController from '../controllers/auth/token-controller';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';

const router = Router();

// Public routes (no authentication required)
router.post('/register', validate('register'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password, firstName, lastName, phone, role, storeId } = req.body;
        const result = await authController.registerUser(email, password, firstName, lastName, phone, role, storeId);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

router.post('/login', validate('login'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = req.body;
        const userAgent = req.headers['user-agent'];
        const result = await authController.authenticateUser(email, password, userAgent);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.post('/verify', validate('verifyAccount'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, code } = req.body;
        const result = await authController.verifyAccount(email, code);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.post('/password/reset-request', validate('requestPasswordReset'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email } = req.body;
        await authController.requestPasswordReset(email);
        res.status(200).json({ message: 'Password reset instructions sent to email' });
    } catch (error) {
        next(error);
    }
});

router.post('/password/reset', validate('resetPassword'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, resetToken, newPassword } = req.body;
        await authController.resetPassword(email, resetToken, newPassword);
        res.status(200).json({ message: 'Password reset successful' });
    } catch (error) {
        next(error);
    }
});

router.post('/refresh', validate('refreshToken'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { refreshToken } = req.body;
        const userAgent = req.headers['user-agent'];
        const result = await tokenController.refreshAccessToken(refreshToken, userAgent);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// Protected routes (authentication required)
router.post('/logout', authenticateToken, validate('logout'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { refreshToken } = req.body;
        const userId = (req as any).user?.id; // Assuming authenticateToken sets req.user
        await authController.logoutUser(refreshToken, userId);
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
});

router.post('/password/change', authenticateToken, validate('changePassword'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;
        const { currentPassword, newPassword } = req.body;
        await authController.changePassword(userId, currentPassword, newPassword);
        res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
        next(error);
    }
});

router.get('/profile', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;
        const result = await authController.getUserProfile(userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

router.put('/profile', authenticateToken, validate('updateProfile'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;
        const updates = req.body;
        const result = await authController.updateUserProfile(userId, updates);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// Verification code management (protected)
router.post('/verification/resend', validate('requestPasswordReset'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email } = req.body;
        const result = await tokenController.resendVerificationCode(email);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// Admin-only routes
router.post('/logout-all/:userId',
    authenticateToken,
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const performedBy = (req as any).user?.id;
            const result = await authController.logoutAllSessions(userId, performedBy);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Token management (admin only)
router.get('/sessions',
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user?.id;
            const result = await tokenController.getUserSessions(userId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

router.delete('/sessions/:tokenId',
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { tokenId } = req.params;
            const performedBy = (req as any).user?.id;
            await tokenController.revokeSession(tokenId, performedBy);
            res.status(200).json({ message: 'Session revoked successfully' });
        } catch (error) {
            next(error);
        }
    }
);

export default router;