"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const prisma_1 = require("../lib/prisma");
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
router.get('/system-stats', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const [totalStores, totalEmployees, totalProducts, totalSales, totalRevenue, activeUsers] = await Promise.all([
            prisma_1.prisma.store.count(),
            prisma_1.prisma.employee.count(),
            prisma_1.prisma.product.count(),
            prisma_1.prisma.sale.count(),
            prisma_1.prisma.sale.aggregate({
                _sum: { total: true }
            }),
            prisma_1.prisma.user.count({
                where: { isActive: true }
            })
        ]);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentSales = await prisma_1.prisma.sale.groupBy({
            by: ['storeId'],
            where: {
                createdAt: { gte: thirtyDaysAgo }
            },
            _sum: { total: true },
            _count: true
        });
        const storeIds = recentSales.map(s => s.storeId);
        const stores = await prisma_1.prisma.store.findMany({
            where: {
                id: { in: storeIds }
            },
            select: {
                id: true,
                name: true,
                location: true
            }
        });
        const storeSales = recentSales.map(sale => {
            const store = stores.find(s => s.id === sale.storeId);
            return {
                storeId: sale.storeId,
                storeName: store?.name || 'Unknown',
                storeLocation: store?.location || '',
                totalSales: sale._count,
                totalRevenue: sale._sum.total || 0
            };
        });
        let topPerformingStore = null;
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
    }
    catch (error) {
        console.error('Failed to get system stats:', error);
        res.status(500).json({ error: 'Failed to get system statistics' });
    }
});
router.get('/user-activity', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const user = req.user;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date();
        let whereCondition = {
            createdAt: {
                gte: startDate,
                lte: endDate
            }
        };
        if (user.role === 'MANAGER') {
            const employees = await prisma_1.prisma.employee.findMany({
                where: { storeId: user.storeId },
                select: { userId: true }
            });
            const userIds = employees.map(e => e.userId);
            whereCondition.userId = { in: userIds };
        }
        const activityStats = await prisma_1.prisma.activityLog.groupBy({
            by: ['action', 'userId'],
            where: whereCondition,
            _count: true
        });
        const userIds = [...new Set(activityStats.map(a => a.userId))];
        const users = await prisma_1.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true
            }
        });
        const formattedStats = activityStats.map(stat => {
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
        const userSummary = {};
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
    }
    catch (error) {
        console.error('Failed to get user activity:', error);
        res.status(500).json({ error: 'Failed to get user activity statistics' });
    }
});
router.get('/store-performance', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const user = req.user;
        let dateRange = { gte: new Date() };
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
        let where = {
            createdAt: dateRange
        };
        if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        const storePerformance = await prisma_1.prisma.sale.groupBy({
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
        const storeIds = storePerformance.map(sp => sp.storeId);
        const stores = await prisma_1.prisma.store.findMany({
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
        performanceData.sort((a, b) => b.totalRevenue - a.totalRevenue);
        res.json({
            period,
            dateRange,
            storeCount: performanceData.length,
            totalRevenue: performanceData.reduce((sum, store) => sum + store.totalRevenue, 0),
            totalSales: performanceData.reduce((sum, store) => sum + store.totalSales, 0),
            stores: performanceData
        });
    }
    catch (error) {
        console.error('Failed to get store performance:', error);
        res.status(500).json({ error: 'Failed to get store performance' });
    }
});
router.get('/product-categories', auth_1.authenticate, async (req, res) => {
    try {
        const user = req.user;
        const { storeId } = req.query;
        let where = {};
        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        else if (user.role === 'CASHIER') {
            const employee = await prisma_1.prisma.employee.findFirst({
                where: { userId: user.id }
            });
            if (employee) {
                where.storeId = employee.storeId;
            }
            else {
                return res.json({ categories: [] });
            }
        }
        const [byType, byGrade, tireCategories, baleCategories] = await Promise.all([
            prisma_1.prisma.product.groupBy({
                by: ['type'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),
            prisma_1.prisma.product.groupBy({
                by: ['grade'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),
            prisma_1.prisma.product.groupBy({
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
            prisma_1.prisma.product.groupBy({
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
    }
    catch (error) {
        console.error('Failed to get product categories:', error);
        res.status(500).json({ error: 'Failed to get product categories' });
    }
});
router.get('/sales-trend', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { period = 'month', storeId } = req.query;
        const user = req.user;
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
        let where = {
            createdAt: {
                gte: startDate,
                lte: endDate
            }
        };
        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        const salesData = await prisma_1.prisma.$queryRaw `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${startDate} 
        AND created_at <= ${endDate}
        ${where.storeId ? client_1.Prisma.sql `AND store_id = ${where.storeId}` : client_1.Prisma.sql ``}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;
        const trendData = salesData.map(item => ({
            date: item.date,
            salesCount: Number(item.sales_count),
            totalRevenue: Number(item.total_revenue),
            averageSale: Number(item.average_sale)
        }));
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
    }
    catch (error) {
        console.error('Failed to get sales trend:', error);
        res.status(500).json({ error: 'Failed to get sales trend' });
    }
});
router.get('/inventory-value', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const user = req.user;
        const { storeId } = req.query;
        let where = {};
        if (storeId && user.role === 'ADMIN') {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        const products = await prisma_1.prisma.product.findMany({
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
        const inventoryValue = products.reduce((sum, product) => {
            return sum + (product.price * product.quantity);
        }, 0);
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
        }, {});
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
        }, {});
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
    }
    catch (error) {
        console.error('Failed to get inventory value:', error);
        res.status(500).json({ error: 'Failed to get inventory value statistics' });
    }
});
exports.default = router;
//# sourceMappingURL=stats-routes.js.map