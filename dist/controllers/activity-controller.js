"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
class ActivityController extends base_controller_1.BaseController {
    async getActivityLogs(req, res) {
        try {
            const user = req.user;
            const { userId, action, entityType, entityId, startDate, endDate, page = 1, limit = 50, storeId } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            let where = {};
            if (user.role === 'CASHIER') {
                where.userId = user.id;
            }
            else if (user.role === 'MANAGER') {
                const employees = await prisma_1.prisma.employee.findMany({
                    where: { storeId: user.storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map(e => e.userId);
                where.userId = { in: employeeUserIds };
            }
            else if (user.role === 'ADMIN' && storeId) {
                const employees = await prisma_1.prisma.employee.findMany({
                    where: { storeId: storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map(e => e.userId);
                where.userId = { in: employeeUserIds };
            }
            if (userId && user.role === 'ADMIN') {
                where.userId = userId;
            }
            if (action) {
                where.action = action;
            }
            if (entityType) {
                where.entityType = entityType;
            }
            if (entityId) {
                where.entityId = entityId;
            }
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate);
                }
            }
            const [activities, total] = await Promise.all([
                prisma_1.prisma.activityLog.findMany({
                    where,
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                                role: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum
                }),
                prisma_1.prisma.activityLog.count({ where })
            ]);
            const availableFilters = await prisma_1.prisma.activityLog.groupBy({
                by: ['action', 'entityType'],
                where: user.role === 'CASHIER' ? { userId: user.id } : {},
                _count: true
            });
            res.json({
                activities,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                },
                filters: availableFilters
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get activity logs');
        }
    }
    async getActivitySummary(req, res) {
        try {
            const user = req.user;
            const { period = 'today', storeId } = req.query;
            let dateFilter = {};
            const now = new Date();
            switch (period) {
                case 'today':
                    dateFilter.gte = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'week':
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    dateFilter.gte = weekAgo;
                    break;
                case 'month':
                    const monthAgo = new Date();
                    monthAgo.setMonth(monthAgo.getMonth() - 1);
                    dateFilter.gte = monthAgo;
                    break;
            }
            let userFilter = {};
            if (user.role === 'CASHIER') {
                userFilter.userId = user.id;
            }
            else if (user.role === 'MANAGER') {
                const employees = await prisma_1.prisma.employee.findMany({
                    where: { storeId: user.storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map(e => e.userId);
                userFilter.userId = { in: employeeUserIds };
            }
            else if (user.role === 'ADMIN' && storeId) {
                const employees = await prisma_1.prisma.employee.findMany({
                    where: { storeId: storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map(e => e.userId);
                userFilter.userId = { in: employeeUserIds };
            }
            const where = {
                ...userFilter,
                createdAt: dateFilter
            };
            const activitiesByAction = await prisma_1.prisma.activityLog.groupBy({
                by: ['action'],
                where,
                _count: true
            });
            const activitiesByUser = await prisma_1.prisma.activityLog.groupBy({
                by: ['userId'],
                where,
                _count: true,
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 10
            });
            const usersWithDetails = await Promise.all(activitiesByUser.map(async (item) => {
                const userRecord = await prisma_1.prisma.user.findUnique({
                    where: { id: item.userId },
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                        role: true
                    }
                });
                return {
                    userId: item.userId,
                    name: userRecord ? `${userRecord.firstName} ${userRecord.lastName}` : 'Unknown',
                    email: userRecord?.email,
                    role: userRecord?.role,
                    activityCount: item._count
                };
            }));
            const recentCriticalActivities = await prisma_1.prisma.activityLog.findMany({
                where: {
                    ...where,
                    action: {
                        in: ['CREATE_SALE', 'VOID_SALE', 'UPDATE_QUANTITY', 'DELETE_PRODUCT']
                    }
                },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 10
            });
            res.json({
                summary: {
                    totalActivities: activitiesByAction.reduce((sum, item) => sum + item._count, 0),
                    byAction: activitiesByAction
                },
                topUsers: usersWithDetails,
                recentCriticalActivities
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get activity summary');
        }
    }
    async logActivity(userId, action, entityType, entityId, details = {}) {
        try {
            await prisma_1.prisma.activityLog.create({
                data: {
                    userId,
                    action,
                    entityType,
                    entityId,
                    details
                }
            });
        }
        catch (error) {
            console.error('Failed to log activity:', error);
        }
    }
}
exports.ActivityController = ActivityController;
//# sourceMappingURL=activity-controller.js.map