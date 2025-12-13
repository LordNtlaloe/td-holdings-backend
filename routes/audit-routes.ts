import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validation-middleware';
import { authenticateToken, requireRole } from '../middleware/auth-middleware';
import * as activityController from '../controllers/audit/activity-controller';
import * as tokenController from '../controllers/auth/token-controller';

const router = Router();

// All audit routes require authentication
router.use(authenticateToken);

// Get activity logs with filters
router.get('/activities', 
    requireRole('ADMIN', 'MANAGER'), 
    validate('activityLogFilter', 'query'), 
    validate('pagination', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            
            const filters = {
                userId: req.query.userId as string,
                action: req.query.action as string,
                entityType: req.query.entityType as string,
                entityId: req.query.entityId as string,
                dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
                dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
                search: req.query.search as string
            };
            
            const result = await activityController.getActivityLogs(filters, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get user activity timeline
router.get('/activities/user/:userId', 
    requireRole('ADMIN', 'MANAGER'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId } = req.params;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
            
            const result = await activityController.getUserActivityTimeline(userId, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get entity activity history
router.get('/activities/entity/:entityType/:entityId', 
    requireRole('ADMIN', 'MANAGER'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { entityType, entityId } = req.params;
            
            const result = await activityController.getEntityActivityHistory(entityType, entityId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get system audit summary
router.get('/summary', 
    requireRole('ADMIN'), 
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
            const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;
            
            const result = await activityController.getAuditSummary(dateFrom, dateTo);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Export activity logs
router.get('/export', 
    requireRole('ADMIN'), 
    validate('dateRange', 'query'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
            const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;
            const entityType = req.query.entityType as string;
            
            const result = await activityController.exportActivityLogs(dateFrom, dateTo, entityType);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Get suspicious activity alerts
router.get('/alerts/suspicious', 
    requireRole('ADMIN'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await activityController.getSuspiciousActivityAlerts();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// ============ SYSTEM MAINTENANCE ROUTES ============

// Cleanup expired tokens (admin only, typically called via cron)
router.post('/cleanup/tokens', 
    requireRole('ADMIN'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await tokenController.cleanupExpiredTokens();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Cleanup verification codes
router.post('/cleanup/verification-codes', 
    requireRole('ADMIN'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await tokenController.cleanupVerificationCodes();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Cleanup password reset tokens
router.post('/cleanup/password-reset-tokens', 
    requireRole('ADMIN'), 
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await tokenController.cleanupPasswordResetTokens();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Cleanup old activity logs
router.post('/cleanup/activity-logs', 
    requireRole('ADMIN'), 
    validate('cleanupSettings'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { daysToKeep, batchSize } = req.body;
            
            const result = await activityController.cleanupOldActivityLogs(daysToKeep, batchSize);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

export default router;