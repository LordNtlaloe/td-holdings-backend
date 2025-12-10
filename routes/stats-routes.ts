import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = express.Router();

// Get system statistics (Admin only)
router.get('/system-stats', authenticate, requireRole(['ADMIN']), async (req, res) => {
    try {
        const [
            totalStores,
            totalEmployees,
            totalProducts,
            totalSales,
            totalRevenue,
            activeUsers
        ] = await Promise.all([
            prisma.store.count(),
            prisma.employee.count(),
            prisma.product.count(),
            prisma.sale.count(),
            prisma.sale.aggregate({
                _sum: { total: true }
            }),
            prisma.user.count({
                where: { isActive: true }
            })
        ]);

        // Get sales for last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentSales = await prisma.sale.groupBy({
            by: ['storeId'],
            where: {
                createdAt: { gte: thirtyDaysAgo }
            },
            _sum: { total: true },
            _count: true
        });

        // Get store details for recent sales
        const stores = await prisma.store.findMany({
            where: {
                id: { in: recentSales.map((s: { storeId: any; }) => s.storeId) }
            },
            select: {
                id: true,
                name: true,
                location: true
            }
        });

        const storeSales = recentSales.map((sale: { storeId: any; _count: any; _sum: { total: any; }; }) => {
            const store = stores.find((s: { id: any; }) => s.id === sale.storeId);
            return {
                storeId: sale.storeId,
                storeName: store?.name || 'Unknown',
                storeLocation: store?.location || '',
                totalSales: sale._count,
                totalRevenue: sale._sum.total || 0
            };
        });

        res.json({
            system: {
                totalStores,
                totalEmployees,
                totalProducts,
                totalSales,
                totalRevenue: totalRevenue._sum.total || 0,
                activeUsers
            },
            recentPerformance: {
                period: 'last_30_days',
                storeSales,
                topPerformingStore: storeSales.length > 0
                    ? storeSales.reduce((max: { totalRevenue: number; }, store: { totalRevenue: number; }) =>
                        store.totalRevenue > max.totalRevenue ? store : max
                    )
                    : null
            }
        });
    } catch (error) {
        console.error('Failed to get system stats:', error);
        res.status(500).json({ error: 'Failed to get system statistics' });
    }
});

// Get user activity statistics
router.get('/user-activity', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const user = (req as any).user;

        // Date range (default last 7 days)
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date();

        let whereCondition: any = {
            createdAt: {
                gte: startDate,
                lte: endDate
            }
        };

        // For managers, only show their store's activities
        if (user.role === 'MANAGER') {
            const employees = await prisma.employee.findMany({
                where: { storeId: user.storeId },
                select: { userId: true }
            });
            const userIds = employees.map((e: { userId: any; }) => e.userId);
            whereCondition.userId = { in: userIds };
        }

        const activityStats = await prisma.activityLog.groupBy({
            by: ['action', 'userId'],
            where: whereCondition,
            _count: true
        });

        // Get user details
        const userIds = [...new Set(activityStats.map((a: { userId: any; }) => a.userId))];
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true
            }
        });

        // Format response
        const formattedStats = activityStats.map((stat: { userId: any; action: any; _count: any; }) => {
            const user = users.find((u: { id: any; }) => u.id === stat.userId);
            return {
                action: stat.action,
                user: user ? {
                    id: user.id,
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    role: user.role
                } : null,
                count: stat._count
            };
        });

        // Group by user for summary
        const userSummary: Record<string, any> = {};
        formattedStats.forEach((stat: { user: { id: any; }; count: any; action: string | number; }) => {
            if (stat.user) {
                const userId = stat.user.id;
                if (!userSummary[userId]) {
                    userSummary[userId] = {
                        user: stat.user,
                        totalActions: 0,
                        actions: {}
                    };
                }
                userSummary[userId].totalActions += stat.count;
                userSummary[userId].actions[stat.action] = stat.count;
            }
        });

        // Convert to array and sort by total actions
        const userSummaryArray = Object.values(userSummary)
            .sort((a: any, b: any) => b.totalActions - a.totalActions);

        res.json({
            period: {
                start: startDate,
                end: endDate
            },
            summary: {
                totalActivities: formattedStats.reduce((sum: any, stat: { count: any; }) => sum + stat.count, 0),
                uniqueUsers: userIds.length,
                mostActiveUser: userSummaryArray[0] || null
            },
            userActivity: userSummaryArray,
            detailedStats: formattedStats
        });
    } catch (error) {
        console.error('Failed to get user activity:', error);
        res.status(500).json({ error: 'Failed to get user activity statistics' });
    }
});

export default router;