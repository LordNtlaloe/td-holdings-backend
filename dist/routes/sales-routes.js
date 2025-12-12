"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const sales_controller_1 = require("../controllers/sales-controller");
const router = express_1.default.Router();
const saleController = new sales_controller_1.SaleController();
const salesRateLimit = (0, auth_1.rateLimit)({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many sales requests, please try again after 15 minutes',
    keyGenerator: (req) => req.ip || 'unknown'
});
router.use(salesRateLimit);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER', 'CASHIER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.createSale), (0, auth_1.logActivity)('CREATE_SALE', 'SALE'), saleController.createSale);
router.get('/', auth_1.authenticate, saleController.getSales);
router.get('/summary', auth_1.authenticate, saleController.getSalesSummary);
router.get('/daily-report', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), saleController.getDailySalesReport);
router.get('/weekly-report', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        req.query.period = 'week';
        req.query.groupBy = 'day';
        return saleController.getDailySalesReport(req, res);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get weekly sales report' });
    }
});
router.get('/monthly-report', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        req.query.period = 'month';
        req.query.groupBy = 'day';
        return saleController.getDailySalesReport(req, res);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get monthly sales report' });
    }
});
router.get('/store/:storeId', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireStoreAccess)(), saleController.getSales);
router.get('/employee/:employeeId', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res, next) => {
    try {
        const user = req.user;
        if (user.role === 'MANAGER') {
            const employee = await req.prisma.employee.findUnique({
                where: { id: req.params.employeeId }
            });
            if (!employee || employee.storeId !== user.storeId) {
                return res.status(403).json({
                    error: 'Access denied to this employee\'s sales'
                });
            }
        }
        next();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to verify employee access' });
    }
}, saleController.getSales);
router.get('/product/:productId', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res, next) => {
    try {
        const user = req.user;
        const product = await req.prisma.product.findUnique({
            where: { id: req.params.productId }
        });
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        if (user.role === 'MANAGER' && product.storeId !== user.storeId) {
            return res.status(403).json({
                error: 'Access denied to this product\'s sales'
            });
        }
        req.query.productId = req.params.productId;
        next();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to verify product access' });
    }
}, saleController.getSales);
router.get('/:id', auth_1.authenticate, (0, auth_1.requireSaleAccess)(), saleController.getSaleById);
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireSaleAccess)(), (0, auth_1.logActivity)('UPDATE_SALE', 'SALE'), async (req, res) => {
    res.status(501).json({
        error: 'Sale updates are not allowed. Create a new sale and void the incorrect one.'
    });
});
router.delete('/:id/void', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireSaleAccess)(), (0, auth_1.validateRequest)(validation_1.validationSchemas.voidSale), (0, auth_1.logActivity)('VOID_SALE', 'SALE'), saleController.voidSale);
router.get('/:id/items', auth_1.authenticate, (0, auth_1.requireSaleAccess)(), async (req, res) => {
    try {
        const sale = await req.prisma.sale.findUnique({
            where: { id: req.params.id },
            include: {
                saleItems: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                grade: true,
                                price: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        res.json(sale.saleItems);
    }
    catch (error) {
        console.error('Failed to get sale items:', error);
        res.status(500).json({ error: 'Failed to get sale items' });
    }
});
router.get('/:id/stats', auth_1.authenticate, (0, auth_1.requireSaleAccess)(), async (req, res) => {
    try {
        const sale = await req.prisma.sale.findUnique({
            where: { id: req.params.id },
            include: {
                saleItems: {
                    include: {
                        product: true
                    }
                },
                employee: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        const stats = {
            saleId: sale.id,
            total: sale.total,
            itemsCount: sale.saleItems.length,
            averageItemPrice: sale.saleItems.length > 0
                ? sale.total / sale.saleItems.length
                : 0,
            byProductType: sale.saleItems.reduce((acc, item) => {
                const type = item.product.type;
                if (!acc[type]) {
                    acc[type] = {
                        count: 0,
                        total: 0,
                        items: []
                    };
                }
                acc[type].count += item.quantity;
                acc[type].total += item.price * item.quantity;
                acc[type].items.push({
                    productId: item.productId,
                    productName: item.product.name,
                    quantity: item.quantity,
                    price: item.price
                });
                return acc;
            }, {}),
            createdAt: sale.createdAt,
            employee: {
                id: sale.employee.id,
                name: `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                email: sale.employee.user.email
            }
        };
        res.json(stats);
    }
    catch (error) {
        console.error('Failed to get sale statistics:', error);
        res.status(500).json({ error: 'Failed to get sale statistics' });
    }
});
router.get('/recent', auth_1.authenticate, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '10');
        const user = req.user;
        let where = {};
        if (user.role !== 'ADMIN') {
            where.storeId = user.storeId;
        }
        const sales = await req.prisma.sale.findMany({
            where,
            include: {
                employee: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                store: {
                    select: {
                        name: true,
                        location: true
                    }
                },
                saleItems: {
                    take: 3,
                    include: {
                        product: {
                            select: {
                                name: true,
                                type: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
        res.json(sales);
    }
    catch (error) {
        console.error('Failed to get recent sales:', error);
        res.status(500).json({ error: 'Failed to get recent sales' });
    }
});
router.get('/recent/:limit', auth_1.authenticate, async (req, res) => {
    try {
        const limit = parseInt(req.params.limit || '10');
        const user = req.user;
        let where = {};
        if (user.role !== 'ADMIN') {
            where.storeId = user.storeId;
        }
        const sales = await req.prisma.sale.findMany({
            where,
            include: {
                employee: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                store: {
                    select: {
                        name: true,
                        location: true
                    }
                },
                saleItems: {
                    take: 3,
                    include: {
                        product: {
                            select: {
                                name: true,
                                type: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
        res.json(sales);
    }
    catch (error) {
        console.error('Failed to get recent sales:', error);
        res.status(500).json({ error: 'Failed to get recent sales' });
    }
});
router.get('/trends/:period', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const period = req.params.period || 'week';
        const user = req.user;
        let groupBy;
        let dateRange;
        switch (period) {
            case 'day':
                groupBy = 'HOUR';
                dateRange = new Date(Date.now() - 24 * 60 * 60 * 1000);
                break;
            case 'week':
                groupBy = 'DAY';
                dateRange = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                groupBy = 'DAY';
                dateRange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'year':
                groupBy = 'MONTH';
                dateRange = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                groupBy = 'DAY';
                dateRange = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        }
        let whereClause = '';
        const params = [dateRange];
        if (user.role !== 'ADMIN') {
            whereClause = 'AND store_id = $2';
            params.push(user.storeId);
        }
        const trends = await req.prisma.$queryRaw `
        SELECT 
          DATE_TRUNC(${groupBy}, created_at) as time_period,
          COUNT(*) as sales_count,
          SUM(total) as total_revenue,
          AVG(total) as average_sale
        FROM sales
        WHERE created_at >= $1
          ${whereClause ? req.prisma.sql `${whereClause}` : req.prisma.sql ``}
        GROUP BY DATE_TRUNC(${groupBy}, created_at)
        ORDER BY time_period
      `;
        const formattedTrends = trends.map((trend) => ({
            period: trend.time_period,
            salesCount: trend.sales_count,
            totalRevenue: parseFloat(trend.total_revenue) || 0,
            averageSale: parseFloat(trend.average_sale) || 0
        }));
        const summary = formattedTrends.reduce((acc, trend) => {
            acc.totalSales += trend.salesCount;
            acc.totalRevenue += trend.totalRevenue;
            return acc;
        }, { totalSales: 0, totalRevenue: 0 });
        summary.averageSale = formattedTrends.length > 0
            ? summary.totalRevenue / summary.totalSales
            : 0;
        res.json({
            period,
            trends: formattedTrends,
            summary,
            analysis: {
                bestPeriod: formattedTrends.length > 0
                    ? formattedTrends.reduce((max, trend) => trend.totalRevenue > max.totalRevenue ? trend : max)
                    : null,
                growthRate: formattedTrends.length >= 2
                    ? ((formattedTrends[formattedTrends.length - 1].totalRevenue -
                        formattedTrends[0].totalRevenue) /
                        formattedTrends[0].totalRevenue) * 100
                    : 0
            }
        });
    }
    catch (error) {
        console.error('Failed to get sales trends:', error);
        res.status(500).json({ error: 'Failed to get sales trends' });
    }
});
router.get('/export/:format', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const format = req.params.format || 'json';
        const { startDate, endDate, storeId } = req.query;
        const user = req.user;
        let where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate)
                where.createdAt.gte = new Date(startDate);
            if (endDate)
                where.createdAt.lte = new Date(endDate);
        }
        if (storeId) {
            where.storeId = storeId;
        }
        else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }
        const sales = await req.prisma.sale.findMany({
            where,
            include: {
                employee: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    }
                },
                store: {
                    select: {
                        name: true,
                        location: true
                    }
                },
                saleItems: {
                    include: {
                        product: {
                            select: {
                                name: true,
                                type: true,
                                grade: true,
                                price: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        switch (format.toLowerCase()) {
            case 'csv':
                const headers = [
                    'Sale ID',
                    'Date',
                    'Store',
                    'Employee',
                    'Total Amount',
                    'Items Count',
                    'Product Details'
                ];
                const csvRows = sales.map((sale) => ({
                    'Sale ID': sale.id,
                    'Date': sale.createdAt.toISOString(),
                    'Store': sale.store.name,
                    'Employee': `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                    'Total Amount': sale.total,
                    'Items Count': sale.saleItems.length,
                    'Product Details': sale.saleItems.map((item) => `${item.product.name} (${item.quantity} x ${item.product.price})`).join('; ')
                }));
                const csv = [
                    headers.join(','),
                    ...csvRows.map((row) => headers.map(header => `"${row[header] || ''}"`).join(','))
                ].join('\n');
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename=sales-export-${new Date().toISOString().split('T')[0]}.csv`);
                res.send(csv);
                break;
            case 'excel':
                res.status(501).json({ error: 'Excel export not yet implemented' });
                break;
            case 'pdf':
                res.status(501).json({ error: 'PDF export not yet implemented' });
                break;
            case 'json':
            default:
                res.json({
                    export: {
                        format: 'json',
                        count: sales.length,
                        dateRange: {
                            start: startDate || 'all',
                            end: endDate || 'all'
                        },
                        generatedAt: new Date().toISOString(),
                        data: sales
                    }
                });
        }
    }
    catch (error) {
        console.error('Failed to export sales:', error);
        res.status(500).json({ error: 'Failed to export sales data' });
    }
});
router.get('/compare', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { period1, period2, storeId1, storeId2, employeeId1, employeeId2 } = req.query;
        const user = req.user;
        const getSalesForPeriod = async (period, storeId, employeeId) => {
            let dateRange;
            const now = new Date();
            switch (period) {
                case 'today':
                    const todayStart = new Date(now.setHours(0, 0, 0, 0));
                    dateRange = { gte: todayStart };
                    break;
                case 'yesterday':
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0));
                    const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999));
                    dateRange = { gte: yesterdayStart, lte: yesterdayEnd };
                    break;
                case 'this_week':
                    const weekStart = new Date(now);
                    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                    weekStart.setHours(0, 0, 0, 0);
                    dateRange = { gte: weekStart };
                    break;
                case 'last_week':
                    const lastWeekStart = new Date(now);
                    lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() - 7);
                    lastWeekStart.setHours(0, 0, 0, 0);
                    const lastWeekEnd = new Date(lastWeekStart);
                    lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
                    lastWeekEnd.setHours(23, 59, 59, 999);
                    dateRange = { gte: lastWeekStart, lte: lastWeekEnd };
                    break;
                case 'this_month':
                    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                    dateRange = { gte: monthStart };
                    break;
                case 'last_month':
                    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                    lastMonthEnd.setHours(23, 59, 59, 999);
                    dateRange = { gte: lastMonthStart, lte: lastMonthEnd };
                    break;
                default:
                    const [startStr, endStr] = period.split('_to_');
                    if (startStr && endStr) {
                        dateRange = {
                            gte: new Date(startStr),
                            lte: new Date(endStr)
                        };
                    }
            }
            if (!dateRange) {
                return null;
            }
            let where = {
                createdAt: dateRange
            };
            if (storeId) {
                where.storeId = storeId;
            }
            else if (user.role === 'MANAGER') {
                where.storeId = user.storeId;
            }
            if (employeeId) {
                where.employeeId = employeeId;
            }
            return await req.prisma.sale.aggregate({
                where,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
        };
        const [data1, data2] = await Promise.all([
            getSalesForPeriod(period1, storeId1, employeeId1),
            getSalesForPeriod(period2, storeId2, employeeId2)
        ]);
        if (!data1) {
            return res.status(400).json({ error: 'Invalid period 1' });
        }
        const comparison = {
            period1: {
                label: period1,
                totalRevenue: data1._sum.total || 0,
                totalSales: data1._count,
                averageSale: data1._avg.total || 0
            },
            period2: data2 ? {
                label: period2,
                totalRevenue: data2._sum.total || 0,
                totalSales: data2._count,
                averageSale: data2._avg.total || 0
            } : null,
            comparison: data2 ? {
                revenueChange: ((data1._sum.total || 0) - (data2._sum.total || 0)) / (data2._sum.total || 1) * 100,
                salesChange: (data1._count - data2._count) / data2._count * 100,
                averageSaleChange: ((data1._avg.total || 0) - (data2._avg.total || 0)) / (data2._avg.total || 1) * 100
            } : null
        };
        res.json(comparison);
    }
    catch (error) {
        console.error('Failed to compare sales:', error);
        res.status(500).json({ error: 'Failed to compare sales' });
    }
});
exports.default = router;
//# sourceMappingURL=sales-routes.js.map