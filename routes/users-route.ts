import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';
import * as authController from '../controllers/auth/auth-controller';

const router = Router();

// All user routes require authentication
router.use(authenticateToken);

// Get all users (admin only)
router.get('/',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Extract query parameters for filtering/pagination
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const filters = {
                role: req.query.role as string,
                storeId: req.query.storeId as string,
                isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
                search: req.query.search as string
            };

            const result = await authController.getAllUsers(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get user by ID
router.get('/:userId',
    requireRole('ADMIN', 'MANAGER'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const result = await authController.getUserById(userId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Update user (admin can update any, users can update themselves)
router.put('/:userId',
    (req: Request, res: Response, next: NextFunction) => {
        // Allow users to update their own profile, admins to update any
        const currentUserId = (req as any).user?.id;
        const currentUserRole = (req as any).user?.role;

        if (req.params.userId === currentUserId || currentUserRole === 'ADMIN') {
            next();
        } else {
            res.status(403).json({ error: 'FORBIDDEN: Cannot update other users' });
        }
    },
    validate('updateProfile'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const updates = req.body;
            const result = await authController.updateUserProfile(userId, updates);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Deactivate user (admin only)
router.post('/:userId/deactivate',
    requireRole('ADMIN'),
    (req: Request, res: Response, next: NextFunction) => {
        const currentUserId = (req as any).user?.id;

        if (req.params.userId === currentUserId) {
            res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF' });
            return;
        }
        next();
    },
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const performedBy = (req as any).user?.id;
            const { reason } = req.body;

            const result = await authController.deactivateUser(userId, performedBy, reason);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Reactivate user (admin only)
router.post('/:userId/reactivate',
    requireRole('ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const performedBy = (req as any).user?.id;
            const { reason } = req.body;

            const result = await authController.reactivateUser(userId, performedBy, reason);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;