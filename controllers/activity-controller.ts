// controllers/activity.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';

export class ActivityController extends BaseController {
    // Get activity logs
    async getActivityLogs(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                userId,
                action,
                entityType,
                entityId,
                startDate,
                endDate,
                page = 1,
                limit = 50,
                storeId
            } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            // Build where clause
            let where: any = {};

            // For admin, show all activities from selected store
            // For manager, show activities from their store employees
            // For cashier, show only their own activities
            if (user.role === 'CASHIER') {
                where.userId = user.id;
            } else if (user.role === 'MANAGER') {
                // Get all employee IDs in manager's store
                const employees = await prisma.employee.findMany({
                    where: { storeId: user.storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map((e: { userId: any; }) => e.userId);
                where.userId = { in: employeeUserIds };
            } else if (user.role === 'ADMIN' && storeId) {
                // Admin filtering by store
                const employees = await prisma.employee.findMany({
                    where: { storeId: storeId as string },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map((e: { userId: any; }) => e.userId);
                where.userId = { in: employeeUserIds };
            }

            // Additional filters
            if (userId && user.role === 'ADMIN') {
                where.userId = userId as string;
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

            // Date filter
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate as string);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate as string);
                }
            }

            // Get activity logs
            const [activities, total] = await Promise.all([
                prisma.activityLog.findMany({
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
                prisma.activityLog.count({ where })
            ]);

            // Get available filters
            const availableFilters = await prisma.activityLog.groupBy({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get activity logs');
        }
    }

    // Get activity summary (for dashboard)
    async getActivitySummary(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { period = 'today', storeId } = req.query;

            let dateFilter: any = {};
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

            // Build user filter based on role
            let userFilter: any = {};
            if (user.role === 'CASHIER') {
                userFilter.userId = user.id;
            } else if (user.role === 'MANAGER') {
                const employees = await prisma.employee.findMany({
                    where: { storeId: user.storeId },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map((e: { userId: any; }) => e.userId);
                userFilter.userId = { in: employeeUserIds };
            } else if (user.role === 'ADMIN' && storeId) {
                const employees = await prisma.employee.findMany({
                    where: { storeId: storeId as string },
                    select: { userId: true }
                });
                const employeeUserIds = employees.map((e: { userId: any; }) => e.userId);
                userFilter.userId = { in: employeeUserIds };
            }

            const where = {
                ...userFilter,
                createdAt: dateFilter
            };

            // Get activity counts by action
            const activitiesByAction = await prisma.activityLog.groupBy({
                by: ['action'],
                where,
                _count: true
            });

            // Get activities by user
            const activitiesByUser = await prisma.activityLog.groupBy({
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

            // Get user details for top users
            const usersWithDetails = await Promise.all(
                activitiesByUser.map(async (item: { userId: any; _count: any; }) => {
                    const userRecord = await prisma.user.findUnique({
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
                })
            );

            // Get recent critical activities
            const recentCriticalActivities = await prisma.activityLog.findMany({
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
                    totalActivities: activitiesByAction.reduce((sum: any, item: { _count: any; }) => sum + item._count, 0),
                    byAction: activitiesByAction
                },
                topUsers: usersWithDetails,
                recentCriticalActivities
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get activity summary');
        }
    }

    // Log activity (internal use)
    async logActivity(
        userId: string,
        action: string,
        entityType: string,
        entityId: string,
        details: any = {}
    ) {
        try {
            await prisma.activityLog.create({
                data: {
                    userId,
                    action,
                    entityType,
                    entityId,
                    details
                }
            });
        } catch (error) {
            console.error('Failed to log activity:', error);
        }
    }
}