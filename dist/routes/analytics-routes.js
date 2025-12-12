"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
router.get('/sales-analytics', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { startDate, endDate, storeId, groupBy = 'day', productType, employeeId } = req.query;
        const user = req.user;
        let where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                where.createdAt.lte = new Date(endDate);
            }
        }
        else {
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 30);
            where.createdAt = { gte: defaultStart };
        }
        if (storeId) {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        if (employeeId) {
            where.employeeId = employeeId;
        }
        let productTypeWhere = {};
        if (productType) {
            productTypeWhere.product = { type: productType };
        }
        let analyticsData;
        if (groupBy === 'day') {
            analyticsData = await prisma_1.prisma.$queryRaw `
        SELECT 
          DATE(s.created_at) as date,
          COUNT(DISTINCT s.id) as sales_count,
          SUM(s.total) as total_revenue,
          AVG(s.total) as average_sale,
          COUNT(si.id) as items_sold,
          COUNT(DISTINCT s.employee_id) as active_employees
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        ${productType ? prisma_1.prisma.sql `LEFT JOIN products p ON si.product_id = p.id` : prisma_1.prisma.sql ``}
        WHERE s.created_at >= ${where.createdAt?.gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
          AND s.created_at <= ${where.createdAt?.lte || new Date()}
          ${where.storeId ? prisma_1.prisma.sql `AND s.store_id = ${where.storeId}` : prisma_1.prisma.sql ``}
          ${where.employeeId ? prisma_1.prisma.sql `AND s.employee_id = ${where.employeeId}` : prisma_1.prisma.sql ``}
          ${productType ? prisma_1.prisma.sql `AND p.type = ${productType}` : prisma_1.prisma.sql ``}
        GROUP BY DATE(s.created_at)
        ORDER BY date
      `;
        }
        else if (groupBy === 'product') {
            analyticsData = await prisma_1.prisma.saleItem.groupBy({
                by: ['productId'],
                where: {
                    sale: where,
                    ...productTypeWhere
                },
                _sum: {
                    quantity: true,
                    price: true
                },
                _count: true,
                orderBy: {
                    _sum: {
                        quantity: 'desc'
                    }
                }
            });
            const productIds = analyticsData.map((item) => item.productId);
            const products = await prisma_1.prisma.product.findMany({
                where: { id: { in: productIds } },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    grade: true,
                    price: true
                }
            });
            analyticsData = analyticsData.map((item) => {
                const product = products.find((p) => p.id === item.productId);
                return {
                    productId: item.productId,
                    productName: product?.name || 'Unknown',
                    productType: product?.type,
                    productGrade: product?.grade,
                    currentPrice: product?.price,
                    totalSold: item._sum.quantity,
                    totalRevenue: item._sum.price,
                    saleCount: item._count,
                    averagePerSale: item._count > 0 ? item._sum.quantity / item._count : 0
                };
            });
        }
        else if (groupBy === 'employee') {
            analyticsData = await prisma_1.prisma.sale.groupBy({
                by: ['employeeId'],
                where,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
            const employeeIds = analyticsData.map((item) => item.employeeId);
            const employees = await prisma_1.prisma.employee.findMany({
                where: { id: { in: employeeIds } },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    },
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                }
            });
            analyticsData = analyticsData.map((item) => {
                const employee = employees.find((e) => e.id === item.employeeId);
                return {
                    employeeId: item.employeeId,
                    employeeName: employee ? `${employee.user.firstName} ${employee.user.lastName}` : 'Unknown',
                    employeeEmail: employee?.user.email,
                    storeName: employee?.store.name,
                    totalSales: item._count,
                    totalRevenue: item._sum.total,
                    averageSale: item._avg.total,
                    performanceScore: item._count > 0 ? (item._sum.total || 0) / item._count : 0
                };
            });
        }
        const summary = await prisma_1.prisma.sale.aggregate({
            where,
            _sum: { total: true },
            _count: true,
            _avg: { total: true },
            _max: { total: true },
            _min: { total: true }
        });
        const trendStart = where.createdAt?.gte
            ? new Date(where.createdAt.gte.getTime() - (where.createdAt.lte?.getTime() - where.createdAt.gte.getTime()))
            : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const trendEnd = where.createdAt?.gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const previousPeriod = await prisma_1.prisma.sale.aggregate({
            where: {
                ...where,
                createdAt: {
                    gte: trendStart,
                    lt: trendEnd
                }
            },
            _sum: { total: true },
            _count: true
        });
        const growthRate = previousPeriod._count > 0
            ? ((summary._count - previousPeriod._count) / previousPeriod._count) * 100
            : 0;
        const revenueGrowth = (previousPeriod._sum.total || 0) > 0
            ? (((summary._sum.total || 0) - (previousPeriod._sum.total || 0)) / (previousPeriod._sum.total || 0)) * 100
            : 0;
        res.json({
            analytics: {
                groupBy,
                data: analyticsData,
                summary: {
                    totalRevenue: summary._sum.total || 0,
                    totalSales: summary._count,
                    averageSale: summary._avg.total || 0,
                    highestSale: summary._max.total || 0,
                    lowestSale: summary._min.total || 0,
                    salesGrowth: growthRate,
                    revenueGrowth: revenueGrowth
                },
                filters: {
                    dateRange: {
                        start: where.createdAt?.gte,
                        end: where.createdAt?.lte
                    },
                    storeId: where.storeId,
                    employeeId: where.employeeId,
                    productType
                }
            }
        });
    }
    catch (error) {
        console.error('Failed to get sales analytics:', error);
        res.status(500).json({ error: 'Failed to get sales analytics' });
    }
});
router.get('/inventory-analytics', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { storeId, category, minStock, maxStock } = req.query;
        const user = req.user;
        let where = {};
        if (storeId) {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        if (category) {
            where.OR = [
                { tireCategory: category },
                { baleCategory: category }
            ];
        }
        if (minStock || maxStock) {
            where.quantity = {};
            if (minStock) {
                where.quantity.gte = parseInt(minStock);
            }
            if (maxStock) {
                where.quantity.lte = parseInt(maxStock);
            }
        }
        const [products, summary, byType, byGrade, valueAnalysis] = await Promise.all([
            prisma_1.prisma.product.findMany({
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
                },
                orderBy: { quantity: 'asc' }
            }),
            prisma_1.prisma.product.aggregate({
                where,
                _sum: {
                    quantity: true,
                    price: true
                },
                _count: true,
                _avg: {
                    price: true,
                    quantity: true
                }
            }),
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
            prisma_1.prisma.$queryRaw `
        SELECT 
          CASE 
            WHEN quantity <= 10 THEN 'low'
            WHEN quantity <= 50 THEN 'medium'
            ELSE 'high'
          END as stock_level,
          COUNT(*) as product_count,
          SUM(price * quantity) as total_value,
          AVG(price) as avg_price
        FROM products
        ${where.storeId ? prisma_1.prisma.sql `WHERE store_id = ${where.storeId}` : prisma_1.prisma.sql ``}
        GROUP BY stock_level
        ORDER BY stock_level
      `
        ]);
        const totalValue = products.reduce((sum, product) => {
            return sum + (product.price * product.quantity);
        }, 0);
        const lowStockItems = products.filter((p) => p.quantity <= 10);
        const outOfStockItems = products.filter((p) => p.quantity === 0);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentSales = await prisma_1.prisma.saleItem.groupBy({
            by: ['productId'],
            where: {
                sale: {
                    createdAt: { gte: thirtyDaysAgo },
                    storeId: where.storeId
                }
            },
            _sum: {
                quantity: true
            }
        });
        const turnoverAnalysis = products.map((product) => {
            const sales = recentSales.find((s) => s.productId === product.id);
            const monthlySales = sales?._sum.quantity || 0;
            const turnoverRate = product.quantity > 0
                ? monthlySales / product.quantity
                : 0;
            return {
                productId: product.id,
                productName: product.name,
                currentStock: product.quantity,
                monthlySales,
                turnoverRate,
                restockUrgency: turnoverRate > 1 ? 'high' : turnoverRate > 0.5 ? 'medium' : 'low'
            };
        });
        res.json({
            summary: {
                totalProducts: summary._count,
                totalStock: summary._sum.quantity || 0,
                averagePrice: summary._avg.price || 0,
                averageStock: summary._avg.quantity || 0,
                totalValue,
                lowStockCount: lowStockItems.length,
                outOfStockCount: outOfStockItems.length
            },
            distribution: {
                byType: byType.map((item) => ({
                    type: item.type,
                    count: item._count,
                    totalStock: item._sum.quantity
                })),
                byGrade: byGrade.map((item) => ({
                    grade: item.grade,
                    count: item._count,
                    totalStock: item._sum.quantity
                }))
            },
            valueAnalysis: valueAnalysis,
            turnoverAnalysis: turnoverAnalysis.sort((a, b) => b.turnoverRate - a.turnoverRate),
            alerts: {
                lowStock: lowStockItems.slice(0, 10),
                outOfStock: outOfStockItems.slice(0, 10),
                highTurnover: turnoverAnalysis
                    .filter((item) => item.turnoverRate > 1)
                    .slice(0, 10)
            }
        });
    }
    catch (error) {
        console.error('Failed to get inventory analytics:', error);
        res.status(500).json({ error: 'Failed to get inventory analytics' });
    }
});
exports.default = router;
//# sourceMappingURL=analytics-routes.js.map