import express from 'express';
import {
    authenticate,
    requireRole,
    requireStoreAccess,
    requireSaleAccess,
    validateRequest,
    logActivity,
    rateLimit
} from '../middleware/auth';
import { validationSchemas } from '../middleware/validation';
import { SaleController } from '../controllers/sales-controller'

const router = express.Router();
const saleController = new SaleController();

// Apply rate limiting to sales routes
const salesRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 requests per windowMs
    message: 'Too many sales requests, please try again after 15 minutes',
    keyGenerator: (req) => req.ip || 'unknown'
});

router.use(salesRateLimit);

// ==================== SALE ROUTES ====================

// Create a new sale
router.post('/',
    authenticate,
    requireRole(['ADMIN', 'MANAGER', 'CASHIER']),
    validateRequest(validationSchemas.createSale),
    logActivity('CREATE_SALE', 'SALE'),
    saleController.createSale
);

// Get all sales (with filters)
router.get('/',
    authenticate,
    saleController.getSales
);

// Get sales summary for dashboard
router.get('/summary',
    authenticate,
    saleController.getSalesSummary
);

// Get daily sales report
router.get('/daily-report',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    saleController.getDailySalesReport
);

// Get weekly sales report
router.get('/weekly-report',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            req.query.period = 'week';
            req.query.groupBy = 'day';
            return saleController.getDailySalesReport(req as any, res);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get weekly sales report' });
        }
    }
);

// Get monthly sales report
router.get('/monthly-report',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            req.query.period = 'month';
            req.query.groupBy = 'day';
            return saleController.getDailySalesReport(req as any, res);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get monthly sales report' });
        }
    }
);

// Get sales by store
router.get('/store/:storeId',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireStoreAccess(),
    saleController.getSales
);

// Get sales by employee
router.get('/employee/:employeeId',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res, next) => {
        try {
            // For managers, verify employee is in their store
            const user = (req as any).user;
            if (user.role === 'MANAGER') {
                const employee = await (req as any).prisma.employee.findUnique({
                    where: { id: req.params.employeeId }
                });

                if (!employee || employee.storeId !== user.storeId) {
                    return res.status(403).json({
                        error: 'Access denied to this employee\'s sales'
                    });
                }
            }
            next();
        } catch (error) {
            res.status(500).json({ error: 'Failed to verify employee access' });
        }
    },
    saleController.getSales
);

// Get sales by product
router.get('/product/:productId',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res, next) => {
        try {
            // Verify product access
            const user = (req as any).user;
            const product = await (req as any).prisma.product.findUnique({
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
        } catch (error) {
            res.status(500).json({ error: 'Failed to verify product access' });
        }
    },
    saleController.getSales
);

// Get sale by ID
router.get('/:id',
    authenticate,
    requireSaleAccess(),
    saleController.getSaleById
);

// Update sale (only for corrections - limited use)
router.put('/:id',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireSaleAccess(),
    logActivity('UPDATE_SALE', 'SALE'),
    async (req, res) => {
        res.status(501).json({
            error: 'Sale updates are not allowed. Create a new sale and void the incorrect one.'
        });
    }
);

// Void a sale
router.delete('/:id/void',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    requireSaleAccess(),
    validateRequest(validationSchemas.voidSale),
    logActivity('VOID_SALE', 'SALE'),
    saleController.voidSale
);

// Get sale items for a specific sale
router.get('/:id/items',
    authenticate,
    requireSaleAccess(),
    async (req, res) => {
        try {
            const sale = await (req as any).prisma.sale.findUnique({
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
        } catch (error) {
            console.error('Failed to get sale items:', error);
            res.status(500).json({ error: 'Failed to get sale items' });
        }
    }
);

// Get sale statistics
router.get('/:id/stats',
    authenticate,
    requireSaleAccess(),
    async (req, res) => {
        try {
            const sale = await (req as any).prisma.sale.findUnique({
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

            // Calculate statistics
            const stats = {
                saleId: sale.id,
                total: sale.total,
                itemsCount: sale.saleItems.length,
                averageItemPrice: sale.saleItems.length > 0
                    ? sale.total / sale.saleItems.length
                    : 0,
                byProductType: sale.saleItems.reduce((acc: any, item: { product: { type: any; name: any; }; quantity: number; price: number; productId: any; }) => {
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
        } catch (error) {
            console.error('Failed to get sale statistics:', error);
            res.status(500).json({ error: 'Failed to get sale statistics' });
        }
    }
);

// Get recent sales (for dashboard)
router.get('/recent/:limit?',
    authenticate,
    async (req, res) => {
        try {
            const limit = parseInt(req.params.limit || '10');
            const user = (req as any).user;

            let where: any = {};

            // Apply store filter for non-admin users
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }

            const sales = await (req as any).prisma.sale.findMany({
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
                        take: 3, // Limit items for performance
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
        } catch (error) {
            console.error('Failed to get recent sales:', error);
            res.status(500).json({ error: 'Failed to get recent sales' });
        }
    }
);

// Get sales trends
router.get('/trends/:period?',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            const period = req.params.period || 'week'; // day, week, month, year
            const user = (req as any).user;

            let groupBy: string;
            let dateRange: Date;

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
            const params: any[] = [dateRange];

            if (user.role !== 'ADMIN') {
                whereClause = 'AND store_id = $2';
                params.push(user.storeId);
            }

            const trends = await (req as any).prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, created_at) as time_period,
          COUNT(*) as sales_count,
          SUM(total) as total_revenue,
          AVG(total) as average_sale
        FROM sales
        WHERE created_at >= $1
          ${whereClause ? (req as any).prisma.sql`${whereClause}` : (req as any).prisma.sql``}
        GROUP BY DATE_TRUNC(${groupBy}, created_at)
        ORDER BY time_period
      `;

            // Format the response
            const formattedTrends = trends.map((trend: any) => ({
                period: trend.time_period,
                salesCount: trend.sales_count,
                totalRevenue: parseFloat(trend.total_revenue) || 0,
                averageSale: parseFloat(trend.average_sale) || 0
            }));

            // Calculate summary
            const summary = formattedTrends.reduce((acc: any, trend: any) => {
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
                        ? formattedTrends.reduce((max: any, trend: any) =>
                            trend.totalRevenue > max.totalRevenue ? trend : max
                        )
                        : null,
                    growthRate: formattedTrends.length >= 2
                        ? ((formattedTrends[formattedTrends.length - 1].totalRevenue -
                            formattedTrends[0].totalRevenue) /
                            formattedTrends[0].totalRevenue) * 100
                        : 0
                }
            });
        } catch (error) {
            console.error('Failed to get sales trends:', error);
            res.status(500).json({ error: 'Failed to get sales trends' });
        }
    }
);

// Export sales data
router.get('/export/:format?',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            const format = req.params.format || 'json';
            const { startDate, endDate, storeId } = req.query;
            const user = (req as any).user;

            // Build where clause
            let where: any = {};

            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) where.createdAt.gte = new Date(startDate as string);
                if (endDate) where.createdAt.lte = new Date(endDate as string);
            }

            if (storeId) {
                where.storeId = storeId as string;
            } else if (user.role === 'MANAGER') {
                where.storeId = user.storeId;
            }

            // Get sales with all details
            const sales = await (req as any).prisma.sale.findMany({
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

            // Format based on requested format
            switch (format.toLowerCase()) {
                case 'csv':
                    // Convert to CSV
                    const headers = [
                        'Sale ID',
                        'Date',
                        'Store',
                        'Employee',
                        'Total Amount',
                        'Items Count',
                        'Product Details'
                    ];

                    const csvRows = sales.map((sale: { id: any; createdAt: { toISOString: () => any; }; store: { name: any; }; employee: { user: { firstName: any; lastName: any; }; }; total: any; saleItems: any[]; }) => ({
                        'Sale ID': sale.id,
                        'Date': sale.createdAt.toISOString(),
                        'Store': sale.store.name,
                        'Employee': `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                        'Total Amount': sale.total,
                        'Items Count': sale.saleItems.length,
                        'Product Details': sale.saleItems.map((item: { product: { name: any; price: any; }; quantity: any; }) =>
                            `${item.product.name} (${item.quantity} x ${item.product.price})`
                        ).join('; ')
                    }));

                    // Generate CSV
                    const csv = [
                        headers.join(','),
                        ...csvRows.map((row: { [x: string]: any; }) =>
                            headers.map(header =>
                                `"${row[header as keyof typeof row] || ''}"`
                            ).join(',')
                        )
                    ].join('\n');

                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename=sales-export-${new Date().toISOString().split('T')[0]}.csv`);
                    res.send(csv);
                    break;

                case 'excel':
                    // For Excel, you'd typically use a library like exceljs
                    res.status(501).json({ error: 'Excel export not yet implemented' });
                    break;

                case 'pdf':
                    // For PDF, you'd typically use a library like pdfkit
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
        } catch (error) {
            console.error('Failed to export sales:', error);
            res.status(500).json({ error: 'Failed to export sales data' });
        }
    }
);

// Get sales comparison (between periods or stores)
router.get('/compare',
    authenticate,
    requireRole(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            const {
                period1,
                period2,
                storeId1,
                storeId2,
                employeeId1,
                employeeId2
            } = req.query;
            const user = (req as any).user;

            // Helper function to get sales for a period
            const getSalesForPeriod = async (period: string, storeId?: string, employeeId?: string) => {
                let dateRange: { gte: Date; lte?: Date } | undefined;
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
                        // Custom date range
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

                // Build where clause
                let where: any = {
                    createdAt: dateRange
                };

                if (storeId) {
                    where.storeId = storeId;
                } else if (user.role === 'MANAGER') {
                    where.storeId = user.storeId;
                }

                if (employeeId) {
                    where.employeeId = employeeId;
                }

                // Get sales summary
                return await (req as any).prisma.sale.aggregate({
                    where,
                    _sum: { total: true },
                    _count: true,
                    _avg: { total: true }
                });
            };

            // Get data for both periods
            const [data1, data2] = await Promise.all([
                getSalesForPeriod(period1 as string, storeId1 as string, employeeId1 as string),
                getSalesForPeriod(period2 as string, storeId2 as string, employeeId2 as string)
            ]);

            if (!data1) {
                return res.status(400).json({ error: 'Invalid period 1' });
            }

            // Calculate comparison
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
        } catch (error) {
            console.error('Failed to compare sales:', error);
            res.status(500).json({ error: 'Failed to compare sales' });
        }
    }
);

export default router;