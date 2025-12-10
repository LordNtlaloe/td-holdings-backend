import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = express.Router();

// Get sales analytics with filters
router.get('/sales-analytics', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            storeId,
            groupBy = 'day',
            productType,
            employeeId
        } = req.query;

        const user = (req as any).user;

        // Build where clause
        let where: any = {};

        // Date filter
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate as string);
            }
            if (endDate) {
                where.createdAt.lte = new Date(endDate as string);
            }
        } else {
            // Default to last 30 days
            const defaultStart = new Date();
            defaultStart.setDate(defaultStart.getDate() - 30);
            where.createdAt = { gte: defaultStart };
        }

        // Store filter
        if (storeId) {
            where.storeId = storeId as string;
        } else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }

        // Employee filter
        if (employeeId) {
            where.employeeId = employeeId as string;
        }

        // Product type filter (via sale items)
        let productTypeWhere: any = {};
        if (productType) {
            productTypeWhere.product = { type: productType };
        }

        // Get analytics based on grouping
        let analyticsData: any;

        if (groupBy === 'day') {
            analyticsData = await prisma.$queryRaw`
        SELECT 
          DATE(s.created_at) as date,
          COUNT(DISTINCT s.id) as sales_count,
          SUM(s.total) as total_revenue,
          AVG(s.total) as average_sale,
          COUNT(si.id) as items_sold,
          COUNT(DISTINCT s.employee_id) as active_employees
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        ${productType ? prisma.sql`LEFT JOIN products p ON si.product_id = p.id` : prisma.sql``}
        WHERE s.created_at >= ${where.createdAt?.gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
          AND s.created_at <= ${where.createdAt?.lte || new Date()}
          ${where.storeId ? prisma.sql`AND s.store_id = ${where.storeId}` : prisma.sql``}
          ${where.employeeId ? prisma.sql`AND s.employee_id = ${where.employeeId}` : prisma.sql``}
          ${productType ? prisma.sql`AND p.type = ${productType}` : prisma.sql``}
        GROUP BY DATE(s.created_at)
        ORDER BY date
      `;
        } else if (groupBy === 'product') {
            analyticsData = await prisma.saleItem.groupBy({
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

            // Get product details
            const productIds = analyticsData.map((item: any) => item.productId);
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    grade: true,
                    price: true
                }
            });

            analyticsData = analyticsData.map((item: any) => {
                const product = products.find((p: { id: any; }) => p.id === item.productId);
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
        } else if (groupBy === 'employee') {
            analyticsData = await prisma.sale.groupBy({
                by: ['employeeId'],
                where,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });

            // Get employee details
            const employeeIds = analyticsData.map((item: any) => item.employeeId);
            const employees = await prisma.employee.findMany({
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

            analyticsData = analyticsData.map((item: any) => {
                const employee = employees.find((e: { id: any; }) => e.id === item.employeeId);
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

        // Get summary statistics
        const summary = await prisma.sale.aggregate({
            where,
            _sum: { total: true },
            _count: true,
            _avg: { total: true },
            _max: { total: true },
            _min: { total: true }
        });

        // Get trend data (comparing with previous period)
        const trendStart = where.createdAt?.gte
            ? new Date(where.createdAt.gte.getTime() - (where.createdAt.lte?.getTime() - where.createdAt.gte.getTime()))
            : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

        const trendEnd = where.createdAt?.gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const previousPeriod = await prisma.sale.aggregate({
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
    } catch (error) {
        console.error('Failed to get sales analytics:', error);
        res.status(500).json({ error: 'Failed to get sales analytics' });
    }
});

// Get inventory analytics
router.get('/inventory-analytics', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { storeId, category, minStock, maxStock } = req.query;
        const user = (req as any).user;

        // Build where clause
        let where: any = {};

        // Store filter
        if (storeId) {
            where.storeId = storeId as string;
        } else if (user.role === 'MANAGER') {
            where.storeId = user.storeId;
        }

        // Category filter
        if (category) {
            where.OR = [
                { tireCategory: category },
                { baleCategory: category }
            ];
        }

        // Stock range filter
        if (minStock || maxStock) {
            where.quantity = {};
            if (minStock) {
                where.quantity.gte = parseInt(minStock as string);
            }
            if (maxStock) {
                where.quantity.lte = parseInt(maxStock as string);
            }
        }

        // Get inventory analytics
        const [products, summary, byType, byGrade, valueAnalysis] = await Promise.all([
            // All products with current stock
            prisma.product.findMany({
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

            // Summary statistics
            prisma.product.aggregate({
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

            // Group by type
            prisma.product.groupBy({
                by: ['type'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // Group by grade
            prisma.product.groupBy({
                by: ['grade'],
                where,
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // Value analysis
            prisma.$queryRaw`
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
        ${where.storeId ? prisma.sql`WHERE store_id = ${where.storeId}` : prisma.sql``}
        GROUP BY stock_level
        ORDER BY stock_level
      `
        ]);

        // Calculate total inventory value
        const totalValue = products.reduce((sum: number, product: { price: number; quantity: number; }) => {
            return sum + (product.price * product.quantity);
        }, 0);

        // Identify low stock items
        const lowStockItems = products.filter((p: { quantity: number; }) => p.quantity <= 10);
        const outOfStockItems = products.filter((p: { quantity: number; }) => p.quantity === 0);

        // Calculate turnover rate (simplified)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentSales = await prisma.saleItem.groupBy({
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

        const turnoverAnalysis = products.map((product: { id: any; quantity: number; name: any; }) => {
            const sales = recentSales.find((s: { productId: any; }) => s.productId === product.id);
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
                byType: byType.map((item: { type: any; _count: any; _sum: { quantity: any; }; }) => ({
                    type: item.type,
                    count: item._count,
                    totalStock: item._sum.quantity
                })),
                byGrade: byGrade.map((item: { grade: any; _count: any; _sum: { quantity: any; }; }) => ({
                    grade: item.grade,
                    count: item._count,
                    totalStock: item._sum.quantity
                }))
            },
            valueAnalysis: valueAnalysis,
            turnoverAnalysis: turnoverAnalysis.sort((a: { turnoverRate: number; }, b: { turnoverRate: number; }) => b.turnoverRate - a.turnoverRate),
            alerts: {
                lowStock: lowStockItems.slice(0, 10),
                outOfStock: outOfStockItems.slice(0, 10),
                highTurnover: turnoverAnalysis
                    .filter((item: { turnoverRate: number; }) => item.turnoverRate > 1)
                    .slice(0, 10)
            }
        });
    } catch (error) {
        console.error('Failed to get inventory analytics:', error);
        res.status(500).json({ error: 'Failed to get inventory analytics' });
    }
});

export default router;