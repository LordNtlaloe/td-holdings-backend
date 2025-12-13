import { prisma } from "../../lib/prisma";

/**
 * AUDIT ACTIVITY CONTROLLER: System-wide audit logging
 * 
 * Aggregate Root: ActivityLog
 * Reads: All tables (for entity references)
 * 
 * Key Responsibility: Provide immutable audit trail of all system activities
 */

// ============ ACTIVITY LOGGING ============

/**
 * Log activity (used by other controllers)
 * 
 * @param userId User ID performing the action
 * @param action Action performed (e.g., "USER_CREATED", "SALE_VOIDED")
 * @param entityType Type of entity affected (e.g., "USER", "PRODUCT", "SALE")
 * @param entityId ID of entity affected
 * @param details Additional details about the action
 * @param ipAddress Optional IP address of user
 * @param userAgent Optional user agent string
 */
export const logActivity = async (
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: any,
    ipAddress?: string,
    userAgent?: string
): Promise<any> => {
    return await prisma.activityLog.create({
        data: {
            userId,
            action,
            entityType,
            entityId,
            details: details || {},
            createdAt: new Date()
            // Note: In production, you might store ipAddress and userAgent
        }
    });
};

/**
 * Get activity logs with filters
 * 
 * @param filters Activity filters
 * @param page Page number
 * @param limit Items per page
 */
export const getActivityLogs = async (
    filters: {
        userId?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        dateFrom?: Date;
        dateTo?: Date;
        search?: string; // Search in action or entityType
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    logs: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.userId) {
        whereCondition.userId = filters.userId;
    }
    if (filters.action) {
        whereCondition.action = filters.action;
    }
    if (filters.entityType) {
        whereCondition.entityType = filters.entityType;
    }
    if (filters.entityId) {
        whereCondition.entityId = filters.entityId;
    }
    if (filters.dateFrom || filters.dateTo) {
        whereCondition.createdAt = {};
        if (filters.dateFrom) whereCondition.createdAt.gte = filters.dateFrom;
        if (filters.dateTo) whereCondition.createdAt.lte = filters.dateTo;
    }
    if (filters.search) {
        whereCondition.OR = [
            { action: { contains: filters.search, mode: 'insensitive' } },
            { entityType: { contains: filters.search, mode: 'insensitive' } }
        ];
    }

    const [logs, total] = await Promise.all([
        prisma.activityLog.findMany({
            where: whereCondition,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        role: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.activityLog.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        logs,
        total,
        page,
        totalPages
    };
};

/**
 * Get user activity timeline
 * 
 * @param userId User ID
 * @param limit Maximum number of activities to return
 */
export const getUserActivityTimeline = async (
    userId: string,
    limit: number = 100
): Promise<any[]> => {
    return await prisma.activityLog.findMany({
        where: { userId },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
    });
};

/**
 * Get entity activity history
 * 
 * @param entityType Entity type (e.g., "PRODUCT", "SALE")
 * @param entityId Entity ID
 */
export const getEntityActivityHistory = async (
    entityType: string,
    entityId: string
): Promise<any[]> => {
    return await prisma.activityLog.findMany({
        where: {
            entityType,
            entityId
        },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    });
};

/**
 * Get system audit summary
 * 
 * @param dateFrom Start date
 * @param dateTo End date
 */
export const getAuditSummary = async (
    dateFrom?: Date,
    dateTo?: Date
): Promise<{
    period: { from?: Date; to?: Date };
    totalActivities: number;
    activitiesByUser: Array<{ userId: string; userName: string; count: number }>;
    activitiesByAction: Array<{ action: string; count: number }>;
    activitiesByEntity: Array<{ entityType: string; count: number }>;
    recentHighImpactActions: any[];
}> => {
    // Build where condition
    const whereCondition: any = {};
    if (dateFrom || dateTo) {
        whereCondition.createdAt = {};
        if (dateFrom) whereCondition.createdAt.gte = dateFrom;
        if (dateTo) whereCondition.createdAt.lte = dateTo;
    }

    const activities = await prisma.activityLog.findMany({
        where: whereCondition,
        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    const totalActivities = activities.length;

    // Group by user
    const userMap = new Map<string, { name: string; count: number }>();
    activities.forEach(log => {
        const userKey = log.userId;
        if (!userMap.has(userKey)) {
            userMap.set(userKey, {
                name: `${log.user.firstName} ${log.user.lastName}`,
                count: 0
            });
        }
        userMap.get(userKey)!.count++;
    });

    // Group by action
    const actionMap = new Map<string, number>();
    activities.forEach(log => {
        const actionKey = log.action;
        actionMap.set(actionKey, (actionMap.get(actionKey) || 0) + 1);
    });

    // Group by entity type
    const entityMap = new Map<string, number>();
    activities.forEach(log => {
        const entityKey = log.entityType;
        entityMap.set(entityKey, (entityMap.get(entityKey) || 0) + 1);
    });

    // Define high-impact actions
    const highImpactActions = [
        'SALE_VOIDED',
        'USER_DEACTIVATED',
        'PASSWORD_CHANGED',
        'TRANSFER_REJECTED',
        'PRODUCT_ARCHIVE_REQUESTED'
    ];

    const recentHighImpactActions = activities
        .filter(log => highImpactActions.includes(log.action))
        .slice(0, 20);

    return {
        period: { from: dateFrom, to: dateTo },
        totalActivities,
        activitiesByUser: Array.from(userMap.entries())
            .map(([userId, data]) => ({
                userId,
                userName: data.name,
                count: data.count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
        activitiesByAction: Array.from(actionMap.entries())
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
        activitiesByEntity: Array.from(entityMap.entries())
            .map(([entityType, count]) => ({ entityType, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
        recentHighImpactActions
    };
};

/**
 * Export activity logs to CSV format
 * 
 * @param dateFrom Start date
 * @param dateTo End date
 * @param entityType Optional entity type filter
 */
export const exportActivityLogs = async (
    dateFrom?: Date,
    dateTo?: Date,
    entityType?: string
): Promise<Array<{
    timestamp: string;
    userId: string;
    userEmail: string;
    userName: string;
    userRole: string;
    action: string;
    entityType: string;
    entityId: string;
    details: string;
}>> => {
    // Build where condition
    const whereCondition: any = {};

    if (dateFrom || dateTo) {
        whereCondition.createdAt = {};
        if (dateFrom) whereCondition.createdAt.gte = dateFrom;
        if (dateTo) whereCondition.createdAt.lte = dateTo;
    }

    if (entityType) {
        whereCondition.entityType = entityType;
    }

    const logs = await prisma.activityLog.findMany({
        where: whereCondition,
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: 10000 // Limit export size
    });

    return logs.map(log => ({
        timestamp: log.createdAt.toISOString(),
        userId: log.userId,
        userEmail: log.user.email,
        userName: `${log.user.firstName} ${log.user.lastName}`,
        userRole: log.user.role,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: JSON.stringify(log.details)
    }));
};

/**
 * Clean up old activity logs (cron job)
 * Archives or deletes logs older than retention period
 * 
 * @param retentionDays Number of days to retain logs (default: 365)
 */
export const cleanupOldActivityLogs = async (
    retentionDays: number = 365,
    batchSize: number
): Promise<{ deleted: number }> => {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // In production, you might want to archive to a separate table or storage
    // before deleting. This is a simplified implementation.

    const result = await prisma.activityLog.deleteMany({
        where: {
            createdAt: { lt: cutoffDate }
        }
    });

    return { deleted: result.count };
};

/**
 * Get suspicious activity alerts
 * Identifies potentially suspicious patterns
 * 
 * @param hoursBack Number of hours to look back (default: 24)
 */
export const getSuspiciousActivityAlerts = async (
    hoursBack: number = 24
): Promise<Array<{
    type: string;
    description: string;
    count: number;
    examples: any[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
}>> => {
    const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const recentActivities = await prisma.activityLog.findMany({
        where: {
            createdAt: { gte: cutoffDate }
        },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    const alerts: Array<{
        type: string;
        description: string;
        count: number;
        examples: any[];
        severity: 'LOW' | 'MEDIUM' | 'HIGH';
    }> = [];

    // Check for multiple failed login attempts
    const failedLogins = recentActivities.filter(
        log => log.action === 'USER_LOGIN' &&
            log.details &&
            typeof log.details === 'object' &&
            !Array.isArray(log.details) &&
            (log.details as any).loginMethod === 'PASSWORD' &&
            (log.details as any).success === false
    );

    if (failedLogins.length >= 5) {
        // Group by IP or user
        const userFailures = new Map<string, number>();
        failedLogins.forEach(log => {
            const userKey = log.userId;
            userFailures.set(userKey, (userFailures.get(userKey) || 0) + 1);
        });

        // Check for users with multiple failures
        Array.from(userFailures.entries()).forEach(([userId, count]) => {
            if (count >= 3) {
                const user = failedLogins.find(log => log.userId === userId)?.user;
                alerts.push({
                    type: 'MULTIPLE_FAILED_LOGINS',
                    description: `User ${user?.email} had ${count} failed login attempts`,
                    count,
                    examples: failedLogins.filter(log => log.userId === userId).slice(0, 3),
                    severity: 'MEDIUM' as const
                });
            }
        });
    }

    // Check for multiple sales voided by same user
    const voidedSales = recentActivities.filter(
        log => log.action === 'SALE_VOIDED'
    );

    if (voidedSales.length >= 3) {
        const userVoids = new Map<string, number>();
        voidedSales.forEach(log => {
            const userKey = log.userId;
            userVoids.set(userKey, (userVoids.get(userKey) || 0) + 1);
        });

        Array.from(userVoids.entries()).forEach(([userId, count]) => {
            if (count >= 3) {
                const user = voidedSales.find(log => log.userId === userId)?.user;
                alerts.push({
                    type: 'MULTIPLE_SALES_VOIDED',
                    description: `User ${user?.email} voided ${count} sales`,
                    count,
                    examples: voidedSales.filter(log => log.userId === userId).slice(0, 3),
                    severity: 'HIGH' as const
                });
            }
        });
    }

    // Check for unusual inventory adjustments
    const inventoryAdjustments = recentActivities.filter(
        log => log.action === 'INVENTORY_ADJUSTED' &&
            log.details &&
            typeof log.details === 'object' &&
            !Array.isArray(log.details) &&
            Math.abs((log.details as any).quantityChange || 0) > 100 // Large adjustments
    );

    if (inventoryAdjustments.length > 0) {
        alerts.push({
            type: 'LARGE_INVENTORY_ADJUSTMENTS',
            description: `${inventoryAdjustments.length} large inventory adjustments detected`,
            count: inventoryAdjustments.length,
            examples: inventoryAdjustments.slice(0, 5),
            severity: 'MEDIUM' as const
        });
    }

    // Check for after-hours activity
    const afterHoursActivities = recentActivities.filter(log => {
        const hour = log.createdAt.getHours();
        return hour < 6 || hour > 22; // Activity between 10 PM and 6 AM
    });

    if (afterHoursActivities.length >= 5) {
        const userMap = new Map<string, number>();
        afterHoursActivities.forEach(log => {
            const userKey = log.userId;
            userMap.set(userKey, (userMap.get(userKey) || 0) + 1);
        });

        Array.from(userMap.entries()).forEach(([userId, count]) => {
            if (count >= 3) {
                const user = afterHoursActivities.find(log => log.userId === userId)?.user;
                alerts.push({
                    type: 'AFTER_HOURS_ACTIVITY',
                    description: `User ${user?.email} had ${count} activities outside business hours`,
                    count,
                    examples: afterHoursActivities.filter(log => log.userId === userId).slice(0, 3),
                    severity: 'LOW' as const
                });
            }
        });
    }

    return alerts;
};