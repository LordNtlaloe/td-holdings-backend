import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import {
    SalesAnalyticsQuery,
    InventoryAnalyticsQuery,
    AuthenticatedRequest,
    SalesAnalyticsResponse,
    InventoryAnalyticsResponse,
    DailySalesData,
    ProductAnalyticsData,
    EmployeeAnalyticsData
} from '../types';
import { ProductType, ProductGrade, Prisma } from '@prisma/client';

const router = express.Router();

// Constants
const ANALYTICS_CONFIG = {
    DEFAULT_PERIOD_DAYS: 30,
    LOW_STOCK_THRESHOLD: 10,
    MEDIUM_STOCK_THRESHOLD: 50,
    HIGH_TURNOVER_THRESHOLD: 1,
    MEDIUM_TURNOVER_THRESHOLD: 0.5,
    MAX_ALERT_ITEMS: 10,
    DAYS_IN_MS: 24 * 60 * 60 * 1000
} as const;

// Type Definitions for the grouped data results
type GroupedSaleItem = {
    productId: string;
    _sum: {
        quantity: number | null;
        price: number | null;
    };
    _count: number;
};

type GroupedSale = {
    employeeId: string;
    _sum: {
        total: number | null;
    };
    _count: number;
    _avg: {
        total: number | null;
    };
};

// Helper Functions
function buildDateFilter(startDate?: string, endDate?: string): { gte?: Date; lte?: Date } {
    if (startDate || endDate) {
        const filter: { gte?: Date; lte?: Date } = {};
        if (startDate) filter.gte = new Date(startDate);
        if (endDate) filter.lte = new Date(endDate);
        return filter;
    }

    // Default to last 30 days
    const defaultStart = new Date(Date.now() - ANALYTICS_CONFIG.DEFAULT_PERIOD_DAYS * ANALYTICS_CONFIG.DAYS_IN_MS);
    return { gte: defaultStart };
}

function buildStoreFilter(storeId: string | undefined, userRole: string, userStoreId?: string): string | undefined {
    if (storeId) return storeId;
    if (userRole === 'MANAGER' && userStoreId) return userStoreId;
    return undefined;
}

function calculateTrendPeriod(dateFilter: { gte?: Date; lte?: Date }) {
    const startDate = dateFilter.gte || new Date(Date.now() - ANALYTICS_CONFIG.DEFAULT_PERIOD_DAYS * ANALYTICS_CONFIG.DAYS_IN_MS);
    const endDate = dateFilter.lte || new Date();
    const periodLength = endDate.getTime() - startDate.getTime();

    return {
        start: new Date(startDate.getTime() - periodLength),
        end: startDate
    };
}

function calculateGrowthRate(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

// Sales Analytics by Day - Using Prisma aggregations instead of raw SQL
async function getSalesByDay(
    dateFilter: { gte?: Date; lte?: Date },
    storeFilter?: string,
    employeeFilter?: string,
    productTypeFilter?: string
): Promise<DailySalesData[]> {
    // Build the where clause
    const whereClause: Prisma.SaleWhereInput = {
        createdAt: dateFilter
    };

    if (storeFilter) whereClause.storeId = storeFilter;
    if (employeeFilter) whereClause.employeeId = employeeFilter;

    // If we need product type filtering, we need to include the relationship
    if (productTypeFilter) {
        whereClause.saleItems = {
            some: {
                product: {
                    type: productTypeFilter as ProductType
                }
            }
        };
    }

    // Fetch all sales with necessary relations
    const sales = await prisma.sale.findMany({
        where: whereClause,
        include: {
            saleItems: {
                include: {
                    product: true
                },
                ...(productTypeFilter ? {
                    where: {
                        product: {
                            type: productTypeFilter as ProductType
                        }
                    }
                } : {})
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });

    // Group by date manually
    const salesByDate = new Map<string, {
        sales: typeof sales;
        totalRevenue: number;
        itemsCount: number;
        employees: Set<string>;
    }>();

    sales.forEach(sale => {
        const dateKey = sale.createdAt.toISOString().split('T')[0];

        if (!salesByDate.has(dateKey)) {
            salesByDate.set(dateKey, {
                sales: [],
                totalRevenue: 0,
                itemsCount: 0,
                employees: new Set()
            });
        }

        const dayData = salesByDate.get(dateKey)!;
        dayData.sales.push(sale);
        dayData.totalRevenue += Number(sale.total);
        dayData.itemsCount += sale.saleItems.length;
        dayData.employees.add(sale.employeeId);
    });

    // Convert to array format
    return Array.from(salesByDate.entries()).map(([date, data]) => ({
        date: new Date(date),
        sales_count: data.sales.length,
        total_revenue: data.totalRevenue,
        average_sale: data.sales.length > 0 ? data.totalRevenue / data.sales.length : 0,
        items_sold: data.itemsCount,
        active_employees: data.employees.size
    }));
}

// Sales Analytics by Product
async function getSalesByProduct(
    whereClause: Prisma.SaleWhereInput,
    productTypeFilter?: string
): Promise<ProductAnalyticsData[]> {
    const productTypeWhere: Prisma.SaleItemWhereInput | undefined = productTypeFilter ? {
        product: {
            type: productTypeFilter as ProductType
        }
    } : undefined;

    const groupedData = await prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
            sale: whereClause,
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

    const productIds = groupedData.map(item => item.productId);
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

    return groupedData.map((item: GroupedSaleItem) => {
        const product = products.find(p => p.id === item.productId);
        return {
            productId: item.productId,
            productName: product?.name || 'Unknown',
            productType: product?.type || null,
            productGrade: product?.grade || null,
            currentPrice: product?.price || 0,
            totalSold: item._sum.quantity || 0,
            totalRevenue: item._sum.price || 0,
            saleCount: item._count,
            averagePerSale: item._count > 0 ? (item._sum.quantity || 0) / item._count : 0
        };
    });
}

// Sales Analytics by Employee
async function getSalesByEmployee(whereClause: Prisma.SaleWhereInput): Promise<EmployeeAnalyticsData[]> {
    const groupedData = await prisma.sale.groupBy({
        by: ['employeeId'],
        where: whereClause,
        _sum: { total: true },
        _count: true,
        _avg: { total: true }
    });

    const employeeIds = groupedData.map((item: GroupedSale) => item.employeeId);
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

    return groupedData.map((item: GroupedSale) => {
        const employee = employees.find(e => e.id === item.employeeId);
        return {
            employeeId: item.employeeId,
            employeeName: employee ? `${employee.user.firstName} ${employee.user.lastName}` : 'Unknown',
            employeeEmail: employee?.user.email || null,
            storeName: employee?.store.name || null,
            storeLocation: employee?.store.location || null,
            totalSales: item._count,
            totalRevenue: item._sum.total || 0,
            averageSale: item._avg.total || 0,
            performanceScore: item._count > 0 ? (item._sum.total || 0) / item._count : 0
        };
    });
}

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
        } = req.query as SalesAnalyticsQuery;

        const user = (req as AuthenticatedRequest).user;

        // Build filters
        const dateFilter = buildDateFilter(startDate, endDate);
        const storeFilter = buildStoreFilter(storeId, user.role, user.storeId);
        const employeeFilter = employeeId;

        // Build where clause for aggregations
        const whereClause: Prisma.SaleWhereInput = {
            createdAt: dateFilter
        };

        if (storeFilter) whereClause.storeId = storeFilter;
        if (employeeFilter) whereClause.employeeId = employeeFilter;

        // Get analytics based on grouping
        let analyticsData: DailySalesData[] | ProductAnalyticsData[] | EmployeeAnalyticsData[];

        switch (groupBy) {
            case 'day':
                analyticsData = await getSalesByDay(dateFilter, storeFilter, employeeFilter, productType);
                break;
            case 'product':
                analyticsData = await getSalesByProduct(whereClause, productType);
                break;
            case 'employee':
                analyticsData = await getSalesByEmployee(whereClause);
                break;
            default:
                return res.status(400).json({ error: 'Invalid groupBy parameter. Must be day, product, or employee' });
        }

        // Get summary statistics
        const summary = await prisma.sale.aggregate({
            where: whereClause,
            _sum: { total: true },
            _count: true,
            _avg: { total: true },
            _max: { total: true },
            _min: { total: true }
        });

        // Get trend data (comparing with previous period)
        const trendPeriod = calculateTrendPeriod(dateFilter);
        const previousPeriod = await prisma.sale.aggregate({
            where: {
                ...whereClause,
                createdAt: {
                    gte: trendPeriod.start,
                    lt: trendPeriod.end
                }
            },
            _sum: { total: true },
            _count: true
        });

        const salesGrowth = calculateGrowthRate(summary._count, previousPeriod._count);
        const revenueGrowth = calculateGrowthRate(summary._sum.total || 0, previousPeriod._sum.total || 0);

        const response: SalesAnalyticsResponse = {
            analytics: {
                groupBy,
                data: analyticsData,
                summary: {
                    totalRevenue: summary._sum.total || 0,
                    totalSales: summary._count,
                    averageSale: summary._avg.total || 0,
                    highestSale: summary._max.total || 0,
                    lowestSale: summary._min.total || 0,
                    salesGrowth: Number(salesGrowth.toFixed(2)),
                    revenueGrowth: Number(revenueGrowth.toFixed(2))
                },
                filters: {
                    dateRange: {
                        start: dateFilter.gte,
                        end: dateFilter.lte
                    },
                    storeId: storeFilter,
                    employeeId: employeeFilter,
                    productType
                }
            }
        };

        res.json(response);
    } catch (error) {
        console.error('Failed to get sales analytics:', error);
        res.status(500).json({
            error: 'Failed to get sales analytics',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get inventory analytics - Using Prisma's native methods
router.get('/inventory-analytics', authenticate, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { storeId, category, minStock, maxStock } = req.query as InventoryAnalyticsQuery;
        const user = (req as AuthenticatedRequest).user;

        // Build where clause
        const whereClause: Prisma.ProductWhereInput = {};

        // Store filter
        const storeFilter = buildStoreFilter(storeId, user.role, user.storeId);
        if (storeFilter) whereClause.storeId = storeFilter;

        // Category filter
        if (category) {
            whereClause.OR = [
                // { tireCategory: category },
                { baleCategory: category }
            ];
        }

        // Stock range filter
        if (minStock !== undefined || maxStock !== undefined) {
            whereClause.quantity = {};
            if (minStock !== undefined) whereClause.quantity.gte = parseInt(minStock);
            if (maxStock !== undefined) whereClause.quantity.lte = parseInt(maxStock);
        }

        // Execute all queries in parallel
        const [products, summary, byType, byGrade] = await Promise.all([
            // All products with current stock
            prisma.product.findMany({
                where: whereClause,
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
                where: whereClause,
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
                where: whereClause,
                _sum: {
                    quantity: true
                },
                _count: true
            }),

            // Group by grade
            prisma.product.groupBy({
                by: ['grade'],
                where: whereClause,
                _sum: {
                    quantity: true
                },
                _count: true
            })
        ]);

        // Calculate value analysis from products (in-memory grouping)
        type StockLevel = 'low' | 'medium' | 'high';
        const valueAnalysis = products.reduce((acc, product) => {
            let stockLevel: StockLevel;
            if (product.quantity <= ANALYTICS_CONFIG.LOW_STOCK_THRESHOLD) {
                stockLevel = 'low';
            } else if (product.quantity <= ANALYTICS_CONFIG.MEDIUM_STOCK_THRESHOLD) {
                stockLevel = 'medium';
            } else {
                stockLevel = 'high';
            }

            if (!acc[stockLevel]) {
                acc[stockLevel] = {
                    stockLevel,
                    productCount: 0,
                    totalValue: 0,
                    totalPrice: 0,
                    count: 0
                };
            }

            acc[stockLevel].productCount++;
            acc[stockLevel].totalValue += product.price * product.quantity;
            acc[stockLevel].totalPrice += product.price;
            acc[stockLevel].count++;

            return acc;
        }, {} as Record<StockLevel, {
            stockLevel: StockLevel;
            productCount: number;
            totalValue: number;
            totalPrice: number;
            count: number;
        }>);

        const formattedValueAnalysis = Object.values(valueAnalysis).map(item => ({
            stockLevel: item.stockLevel,
            productCount: item.productCount,
            totalValue: Number(item.totalValue.toFixed(2)),
            avgPrice: Number((item.totalPrice / item.count).toFixed(2))
        })).sort((a, b) => {
            const order = { low: 1, medium: 2, high: 3 };
            return order[a.stockLevel as StockLevel] - order[b.stockLevel as StockLevel];
        });

        // Calculate total inventory value
        const totalValue = products.reduce((sum, product) => {
            return sum + (product.price * product.quantity);
        }, 0);

        // Identify critical stock items
        const lowStockItems = products.filter(p => p.quantity <= ANALYTICS_CONFIG.LOW_STOCK_THRESHOLD && p.quantity > 0);
        const outOfStockItems = products.filter(p => p.quantity === 0);

        // Calculate turnover rate
        const thirtyDaysAgo = new Date(Date.now() - ANALYTICS_CONFIG.DEFAULT_PERIOD_DAYS * ANALYTICS_CONFIG.DAYS_IN_MS);

        const recentSales = await prisma.saleItem.groupBy({
            by: ['productId'],
            where: {
                sale: {
                    createdAt: { gte: thirtyDaysAgo },
                    ...(storeFilter && { storeId: storeFilter })
                }
            },
            _sum: {
                quantity: true
            }
        });

        // Calculate turnover for each product
        const turnoverAnalysis = products.map(product => {
            const sales = recentSales.find(s => s.productId === product.id);
            const monthlySales = sales?._sum.quantity || 0;
            const turnoverRate = product.quantity > 0 ? monthlySales / product.quantity : 0;

            let restockUrgency: 'high' | 'medium' | 'low';
            if (turnoverRate >= ANALYTICS_CONFIG.HIGH_TURNOVER_THRESHOLD) {
                restockUrgency = 'high';
            } else if (turnoverRate >= ANALYTICS_CONFIG.MEDIUM_TURNOVER_THRESHOLD) {
                restockUrgency = 'medium';
            } else {
                restockUrgency = 'low';
            }

            return {
                productId: product.id,
                productName: product.name,
                currentStock: product.quantity,
                monthlySales,
                turnoverRate: Number(turnoverRate.toFixed(2)),
                restockUrgency,
                daysUntilStockout: turnoverRate > 0 ? Math.floor(product.quantity / (monthlySales / 30)) : null
            };
        });

        // Type definitions for grouped results
        type GroupedProductType = {
            type: ProductType;
            _sum: {
                quantity: number | null;
            };
            _count: number;
        };

        type GroupedProductGrade = {
            grade: ProductGrade;
            _sum: {
                quantity: number | null;
            };
            _count: number;
        };

        const response: InventoryAnalyticsResponse = {
            summary: {
                totalProducts: summary._count,
                totalStock: summary._sum.quantity || 0,
                averagePrice: summary._avg.price || 0,
                averageStock: summary._avg.quantity || 0,
                totalValue: Number(totalValue.toFixed(2)),
                lowStockCount: lowStockItems.length,
                outOfStockCount: outOfStockItems.length
            },
            distribution: {
                byType: byType.map((item: GroupedProductType) => ({
                    type: item.type,
                    count: item._count,
                    totalStock: item._sum.quantity || 0
                })),
                byGrade: byGrade.map((item: GroupedProductGrade) => ({
                    grade: item.grade,
                    count: item._count,
                    totalStock: item._sum.quantity || 0
                }))
            },
            valueAnalysis: formattedValueAnalysis,
            turnoverAnalysis: turnoverAnalysis
                .sort((a, b) => b.turnoverRate - a.turnoverRate)
                .slice(0, 50),
            alerts: {
                lowStock: lowStockItems.slice(0, ANALYTICS_CONFIG.MAX_ALERT_ITEMS),
                outOfStock: outOfStockItems.slice(0, ANALYTICS_CONFIG.MAX_ALERT_ITEMS),
                highTurnover: turnoverAnalysis
                    .filter(item => item.turnoverRate >= ANALYTICS_CONFIG.HIGH_TURNOVER_THRESHOLD)
                    .sort((a, b) => b.turnoverRate - a.turnoverRate)
                    .slice(0, ANALYTICS_CONFIG.MAX_ALERT_ITEMS)
            }
        };

        res.json(response);
    } catch (error) {
        console.error('Failed to get inventory analytics:', error);
        res.status(500).json({
            error: 'Failed to get inventory analytics',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;