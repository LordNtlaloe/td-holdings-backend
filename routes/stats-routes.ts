import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { Role } from '../generated/prisma/enums';

const router = express.Router();

// Type definitions
interface StoreSales {
    storeId: string;
    storeName: string;
    storeLocation: string;
    totalSales: number;
    totalRevenue: number;
}

interface ActivityStat {
    userId: string;
    action: string;
    _count: number;
}

interface FormattedStat {
    action: string;
    user: {
        id: string;
        name: string;
        email: string;
        role: Role;
    } | null;
    count: number;
}

interface UserSummary {
    user: {
        id: string;
        name: string;
        email: string;
        role: Role;
    };
    totalActions: number;
    actions: Record<string, number>;
}

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
        const storeIds = recentSales.map(s => s.storeId);
        const stores = await prisma.store.findMany({
            where: {
                id: { in: storeIds }
            },
            select: {
                id: true,
                name: true,
                location: true
            }
        });

        const storeSales: StoreSales[] = recentSales.map(sale => {
            const store = stores.find(s => s.id === sale.storeId);
            return {
                storeId: sale.storeId,
                storeName: store?.name || 'Unknown',
                storeLocation: store?.location || '',
                totalSales: sale._count,
                totalRevenue: sale._sum.total || 0
            };
        });

        // Find top performing store
        let topPerformingStore: StoreSales | null = null;
        if (storeSales.length > 0) {
            topPerformingStore = storeSales.reduce((max, store) => {
                return store.totalRevenue > max.totalRevenue ? store : max;
            });
        }

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
                topPerformingStore
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

        let whereCondition: Prisma.ActivityLogWhereInput = {
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
            const userIds = employees.map(e => e.userId);
            whereCondition.userId = { in: userIds };
        }

        const activityStats = await prisma.activityLog.groupBy({
            by: ['action', 'userId'],
            where: whereCondition,
            _count: true
        });

        // Get user details
        const userIds = [...new Set(activityStats.map(a => a.userId))];
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
        const formattedStats: FormattedStat[] = activityStats.map(stat => {
            const user = users.find(u => u.id === stat.userId);
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
        const userSummary: Record<string, UserSummary> = {};

        formattedStats.forEach(stat => {
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
            .sort((a, b) => b.totalActions - a.totalActions);

        const totalActivities = formattedStats.reduce((sum, stat) => sum + stat.count, 0);

        res.json({
            period: {
                start: startDate,
                end: endDate
            },
            summary: {
                totalActivities,
                uniqueUsers: userIds.length,
                mostActiveUser: userSummaryArray[0]?.user || null
            },
            userActivity: userSummaryArray,
            detailedStats: formattedStats
        });
    } catch (error) {
        console.error('Failed to get user activity:', error);
        res.status(500).json({ error: 'Failed to get user activity statistics' });
    }
});

// Get store performance comparison
router.get('/store-performance', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const user = (req as any).user;

        let dateRange: { gte: Date; lte?: Date } = { gte: new Date() };

        switch (period) {
            case 'week':
                dateRange.gte.setDate(dateRange.gte.getDate() - 7);
                break;
            case 'month':
                dateRange.gte.setMonth(dateRange.gte.getMonth() - 1);
                break;
            case 'quarter':
                dateRange.gte.setMonth(dateRange.gte.getMonth() - 3);
                break;
            case 'year':
                dateRange.gte.setFullYear(dateRange.gte.getFullYear() - 1);
                break;
            default:
                dateRange.gte.setMonth(dateRange.gte.getMonth() - 1);
        }

        // Build where clause
        let where: Prisma.SaleWhereInput = {
            createdAt: dateRange
        };

        // For managers, only show their store
        if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }

        // Get store performance
        const storePerformance = await prisma.sale.groupBy({
            by: ['storeId'],
            where,
            _sum: {
                total: true
            },
            _count: true,
            _avg: {
                total: true
            }
        });

        // Get store details
        const storeIds = storePerformance.map(sp => sp.storeId);
        const stores = await prisma.store.findMany({
            where: {
                id: { in: storeIds }
            },
            select: {
                id: true,
                name: true,
                location: true,
                _count: {
                    select: {
                        employees: true,
                        products: true
                    }
                }
            }
        });

        // Format response
        const performanceData = storePerformance.map(sp => {
            const store = stores.find(s => s.id === sp.storeId);
            return {
                storeId: sp.storeId,
                storeName: store?.name || 'Unknown',
                storeLocation: store?.location || '',
                employeeCount: store?._count.employees || 0,
                productCount: store?._count.products || 0,
                totalSales: sp._count,
                totalRevenue: sp._sum.total || 0,
                averageSale: sp._avg.total || 0
            };
        });

        // Sort by total revenue
        performanceData.sort((a, b) => b.totalRevenue - a.totalRevenue);

        res.json({
            period,
            dateRange,
            storeCount: performanceData.length,
            totalRevenue: performanceData.reduce((sum, store) => sum + store.totalRevenue, 0),
            totalSales: performanceData.reduce((sum, store) => sum + store.totalSales, 0),
            stores: performanceData
        });
    } catch (error) {
        console.error('Failed to get store performance:', error);
        res.status(500).json({ error: 'Failed to get store performance' });
    }
});

// Get product category statistics
router.get('/product-categories', authenticate, async (req, res) => {
    try {
        const user = (req as any).user;
        const { storeId } = req.query;

        // Build where clause
        let where: Prisma.ProductWhereInput = {};

        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId as string;
        } else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        } else if (user.role === 'CASHIER') {
            // Cashiers can only see their store's products
            const employee = await prisma.employee.findFirst({
                where: { userId: user.id }
            });
            if (employee) {
                where.storeId = employee.storeId;
            } else {
                return res.json({ categories: [] });
            }
        }

        // Get product categories
        const [byType, byGrade, tireCategories, baleCategories] = await Promise.all([
            // By product type
            prisma.product.groupBy({
                by: ['type'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // By grade
            prisma.product.groupBy({
                by: ['grade'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // Tire categories
            prisma.product.groupBy({
                by: ['tireCategory'],
                where: {
                    ...where,
                    type: 'TIRE'
                },
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // Bale categories
            prisma.product.groupBy({
                by: ['baleCategory'],
                where: {
                    ...where,
                    type: 'BALE'
                },
                _sum: {
                    quantity: true
                },
                _count: true
            })
        ]);

        res.json({
            byType: byType.map(item => ({
                type: item.type,
                count: item._count,
                totalStock: item._sum.quantity || 0
            })),
            byGrade: byGrade.map(item => ({
                grade: item.grade,
                count: item._count,
                totalStock: item._sum.quantity || 0
            })),
            tireCategories: tireCategories.map(item => ({
                category: item.tireCategory,
                count: item._count,
                totalStock: item._sum.quantity || 0
            })),
            baleCategories: baleCategories.map(item => ({
                category: item.baleCategory,
                count: item._count,
                totalStock: item._sum.quantity || 0
            }))
        });
    } catch (error) {
        console.error('Failed to get product categories:', error);
        res.status(500).json({ error: 'Failed to get product categories' });
    }
});

// Get sales performance over time
router.get('/sales-trend', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { period = 'month', storeId } = req.query;
        const user = (req as any).user;

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();

        switch (period) {
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case 'quarter':
                startDate.setMonth(startDate.getMonth() - 3);
                break;
            case 'year':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate.setMonth(startDate.getMonth() - 1);
        }

        // Build where clause
        let where: Prisma.SaleWhereInput = {
            createdAt: {
                gte: startDate,
                lte: endDate
            }
        };

        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId as string;
        } else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }

        // Get sales grouped by date
        const salesData = await prisma.$queryRaw<Array<{
            date: string;
            sales_count: bigint;
            total_revenue: number;
            average_sale: number;
        }>>`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${startDate} 
        AND created_at <= ${endDate}
        ${where.storeId ? Prisma.sql`AND store_id = ${where.storeId}` : Prisma.sql``}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

        // Format the data
        const trendData = salesData.map(item => ({
            date: item.date,
            salesCount: Number(item.sales_count),
            totalRevenue: Number(item.total_revenue),
            averageSale: Number(item.average_sale)
        }));

        // Calculate summary
        const summary = {
            totalSales: trendData.reduce((sum, item) => sum + item.salesCount, 0),
            totalRevenue: trendData.reduce((sum, item) => sum + item.totalRevenue, 0),
            averageSale: trendData.length > 0
                ? trendData.reduce((sum, item) => sum + item.averageSale, 0) / trendData.length
                : 0,
            periodDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        };

        res.json({
            period,
            dateRange: { start: startDate, end: endDate },
            summary,
            trend: trendData
        });
    } catch (error) {
        console.error('Failed to get sales trend:', error);
        res.status(500).json({ error: 'Failed to get sales trend' });
    }
});

// Get inventory value statistics
router.get('/inventory-value', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const user = (req as any).user;
        const { storeId } = req.query;

        // Build where clause
        let where: Prisma.ProductWhereInput = {};

        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId as string;
        } else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }

        // Get all products with their values
        const products = await prisma.product.findMany({
            where,
            select: {
                id: true,
                name: true,
                type: true,
                grade: true,
                price: true,
                quantity: true,
                store: {
                    select: {
                        name: true,
                        location: true
                    }
                }
            }
        });

        // Calculate inventory value
        const inventoryValue = products.reduce((sum, product) => {
            return sum + (product.price * product.quantity);
        }, 0);

        // Group by type and grade
        const byType = products.reduce((acc, product) => {
            const type = product.type;
            if (!acc[type]) {
                acc[type] = {
                    count: 0,
                    totalValue: 0,
                    totalStock: 0
                };
            }
            acc[type].count++;
            acc[type].totalValue += product.price * product.quantity;
            acc[type].totalStock += product.quantity;
            return acc;
        }, {} as Record<string, { count: number; totalValue: number; totalStock: number }>);

        const byGrade = products.reduce((acc, product) => {
            const grade = product.grade;
            if (!acc[grade]) {
                acc[grade] = {
                    count: 0,
                    totalValue: 0,
                    totalStock: 0
                };
            }
            acc[grade].count++;
            acc[grade].totalValue += product.price * product.quantity;
            acc[grade].totalStock += product.quantity;
            return acc;
        }, {} as Record<string, { count: number; totalValue: number; totalStock: number }>);

        // Identify high-value items (top 10)
        const highValueItems = products
            .map(product => ({
                id: product.id,
                name: product.name,
                type: product.type,
                grade: product.grade,
                price: product.price,
                quantity: product.quantity,
                totalValue: product.price * product.quantity,
                store: product.store.name
            }))
            .sort((a, b) => b.totalValue - a.totalValue)
            .slice(0, 10);

        // Identify low stock items
        const lowStockItems = products
            .filter(product => product.quantity <= 10)
            .map(product => ({
                id: product.id,
                name: product.name,
                type: product.type,
                quantity: product.quantity,
                value: product.price * product.quantity,
                store: product.store.name
            }))
            .sort((a, b) => a.quantity - b.quantity);

        res.json({
            summary: {
                totalProducts: products.length,
                totalStock: products.reduce((sum, p) => sum + p.quantity, 0),
                totalValue: inventoryValue,
                averageValuePerProduct: products.length > 0 ? inventoryValue / products.length : 0
            },
            byType: Object.entries(byType).map(([type, data]) => ({
                type,
                ...data
            })),
            byGrade: Object.entries(byGrade).map(([grade, data]) => ({
                grade,
                ...data
            })),
            highValueItems,
            lowStockItems: {
                count: lowStockItems.length,
                items: lowStockItems.slice(0, 10),
                totalValueAtRisk: lowStockItems.reduce((sum, item) => sum + item.value, 0)
            }
        });
    } catch (error) {
        console.error('Failed to get inventory value:', error);
        res.status(500).json({ error: 'Failed to get inventory value statistics' });
    }
});

export default router;