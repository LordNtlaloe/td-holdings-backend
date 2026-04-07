import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { formatDateRange } from "../helpers";
import { Prisma } from "../prisma/generated/client";

// Define types for raw query results
interface InventoryHealthItem {
    total_items: number;
    total_value: number;
    low_stock: number;
    overstocked: number;
    avg_quantity: number;
}

interface ExpenseSummaryItem {
    category: string;
    amount: number;
}

interface InventoryTurnoverItem {
    avg_daily_sales: number;
    avg_inventory: number;
}

interface InventoryValueItem {
    total_value: number;
}

interface TurnoverRateItem {
    terminated_count: number;
    active_count: number;
}

interface AvgTenureItem {
    avg_tenure_days: number;
}

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = (req as any).user;
        const { startDate, endDate } = req.query;

        const { start, end } = formatDateRange(startDate as string, endDate as string);

        // Base queries based on user role
        let storeFilter: any = {};
        if (user?.storeId && user.role !== 'ADMIN') {
            storeFilter = { storeId: user.storeId };
        }

        // Get key metrics
        const [
            totalSales,
            totalRevenue,
            totalCustomers,
            lowStockCount,
            pendingTransfers,
            activeEmployees,
            recentSales,
            topProducts,
            storePerformance
        ] = await Promise.all([
            // Total sales count
            prisma.sale.count({
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end }
                }
            }),

            // Total revenue
            prisma.sale.aggregate({
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end }
                },
                _sum: { total: true }
            }),

            // Unique customers
            prisma.sale.aggregate({
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end },
                    customerName: { not: null }
                },
                _count: { customerName: true }
            }),

            // Low stock items
            prisma.inventory.count({
                where: {
                    ...storeFilter,
                    quantity: { lt: prisma.inventory.fields.reorderLevel }
                }
            }),

            // Pending transfers
            prisma.productTransfer.count({
                where: {
                    ...storeFilter,
                    status: 'PENDING'
                }
            }),

            // Active employees
            prisma.employee.count({
                where: {
                    ...storeFilter,
                    status: 'ACTIVE'
                }
            }),

            // Recent sales (last 10)
            prisma.sale.findMany({
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end }
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: {
                    employee: {
                        include: { user: true }
                    },
                    store: true,
                    saleItems: {
                        include: { product: true }
                    }
                }
            }),

            // Top selling products
            prisma.$queryRaw<any>`
        SELECT 
          p.id,
          p.name,
          p.type,
          p.grade,
          SUM(si.quantity) as total_quantity,
          SUM(si.quantity * si.price) as total_revenue,
          COUNT(DISTINCT si."saleId") as sales_count
        FROM "SaleItem" si
        JOIN "Product" p ON p.id = si."productId"
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE ${user?.storeId && user.role !== 'ADMIN' ? Prisma.sql`s."storeId" = ${user.storeId}` : Prisma.sql`1=1`}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
        GROUP BY p.id, p.name, p.type, p.grade
        ORDER BY total_revenue DESC
        LIMIT 10
      `,

            // Store performance (for admins only)
            user?.role === 'ADMIN' ? prisma.$queryRaw<any>`
        SELECT 
          s.id,
          s.name,
          s.location,
          COUNT(sa.id) as sales_count,
          SUM(sa.total) as total_revenue,
          AVG(sa.total) as avg_sale_amount,
          COUNT(DISTINCT sa."employeeId") as active_employees,
          COUNT(DISTINCT sa."customerName") as unique_customers
        FROM "Sale" sa
        JOIN "Store" s ON s.id = sa."storeId"
        WHERE sa."createdAt" >= ${start}
          AND sa."createdAt" <= ${end}
        GROUP BY s.id, s.name, s.location
        ORDER BY total_revenue DESC
        LIMIT 5
      ` : Promise.resolve([])
        ]);

        // Get daily sales trend
        const salesTrend = await prisma.$queryRaw<any>`
      SELECT 
        DATE(s."createdAt") as date,
        COUNT(*) as sales_count,
        SUM(s.total) as total_revenue,
        AVG(s.total) as avg_sale_amount,
        COUNT(DISTINCT s."customerName") as unique_customers
      FROM "Sale" s
      WHERE ${user?.storeId && user.role !== 'ADMIN' ? Prisma.sql`s."storeId" = ${user.storeId}` : Prisma.sql`1=1`}
        AND s."createdAt" >= ${start}
        AND s."createdAt" <= ${end}
      GROUP BY DATE(s."createdAt")
      ORDER BY date ASC
    `;

        // Get inventory health summary
        const inventoryHealth = await prisma.$queryRaw<InventoryHealthItem[]>`
      SELECT 
        COUNT(*) as total_items,
        SUM(i.quantity * COALESCE(i."storePrice", p."basePrice")) as total_value,
        COUNT(CASE WHEN i.quantity < COALESCE(i."reorderLevel", 10) THEN 1 END) as low_stock,
        COUNT(CASE WHEN i.quantity > COALESCE(i."optimalLevel", 50) THEN 1 END) as overstocked,
        AVG(i.quantity) as avg_quantity
      FROM "Inventory" i
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${user?.storeId && user.role !== 'ADMIN' ? Prisma.sql`i."storeId" = ${user.storeId}` : Prisma.sql`1=1`}
    `;

        // Get employee performance
        const employeePerformance = user?.role === 'ADMIN' || user?.role === 'MANAGER' ?
            await prisma.$queryRaw<any>`
        SELECT 
          e.id,
          u."firstName" || ' ' || u."lastName" as employee_name,
          e.position,
          e.role,
          COUNT(s.id) as sales_count,
          SUM(s.total) as total_revenue,
          AVG(s.total) as avg_sale_amount,
          COUNT(DISTINCT s."customerName") as unique_customers
        FROM "Sale" s
        JOIN "Employee" e ON e.id = s."employeeId"
        JOIN "User" u ON u.id = e."userId"
        WHERE ${user?.storeId && user.role !== 'ADMIN' ? Prisma.sql`s."storeId" = ${user.storeId}` : Prisma.sql`1=1`}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
        GROUP BY e.id, u."firstName", u."lastName", e.position, e.role
        ORDER BY total_revenue DESC
        LIMIT 5
      ` : Promise.resolve([]);

        // Calculate metrics
        const inventoryHealthData = inventoryHealth[0];
        const metrics = {
            sales: {
                total: totalSales,
                revenue: totalRevenue._sum.total || 0,
                average: totalSales > 0 ? (totalRevenue._sum.total || 0) / totalSales : 0,
                uniqueCustomers: totalCustomers._count.customerName || 0
            },
            inventory: {
                lowStock: lowStockCount,
                totalValue: inventoryHealthData?.total_value || 0,
                averageQuantity: inventoryHealthData?.avg_quantity || 0,
                healthScore: inventoryHealthData?.total_items > 0 ?
                    100 - ((inventoryHealthData?.low_stock / inventoryHealthData?.total_items) * 100) : 100
            },
            operations: {
                pendingTransfers,
                activeEmployees,
                completionRate: pendingTransfers > 0 ?
                    (await prisma.productTransfer.count({
                        where: {
                            ...storeFilter,
                            status: 'COMPLETED',
                            createdAt: { gte: start, lte: end }
                        }
                    })) / pendingTransfers * 100 : 100
            }
        };

        res.json({
            metrics,
            salesTrend,
            recentSales,
            topProducts,
            storePerformance,
            inventoryHealth: inventoryHealthData,
            employeePerformance,
            userContext: {
                role: user?.role,
                storeId: user?.storeId,
                dateRange: { start, end }
            }
        });
    } catch (error) {
        console.error("Get dashboard data error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getFinancialSummary = async (req: Request, res: Response): Promise<void> => {
    try {
        const { startDate, endDate, storeId } = req.query;
        const user = (req as any).user;

        const { start, end } = formatDateRange(startDate as string, endDate as string);

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && (!user || user.role !== 'ADMIN')) {
            storeFilter = { storeId: storeIdValue };
        }

        // Get financial data
        const [
            revenueSummary,
            expenseSummary,
            taxSummary,
            paymentMethods,
            dailyRevenue,
            productPerformance,
            voidedSummary
        ] = await Promise.all([
            // Revenue summary
            prisma.sale.aggregate({
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end }
                },
                _sum: { total: true, subtotal: true, tax: true },
                _count: true,
                _avg: { total: true }
            }),

            // Expense summary (simplified - would integrate with accounting system)
            prisma.$queryRaw<ExpenseSummaryItem[]>`
        SELECT 
          'INVENTORY_COST' as category,
          SUM(i.quantity * p."basePrice") as amount
        FROM "Inventory" i
        JOIN "Product" p ON p.id = i."productId"
        WHERE ${storeIdValue ? Prisma.sql`i."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
        UNION ALL
        SELECT 
          'TRANSFER_COST' as category,
          SUM(pt.quantity * p."basePrice") as amount
        FROM "ProductTransfer" pt
        JOIN "Product" p ON p.id = pt."productId"
        WHERE ${storeIdValue ? Prisma.sql`(pt."fromStoreId" = ${storeIdValue} OR pt."toStoreId" = ${storeIdValue})` : Prisma.sql`1=1`}
          AND pt."createdAt" >= ${start}
          AND pt."createdAt" <= ${end}
      `,

            // Tax summary by period
            prisma.$queryRaw<any>`
        SELECT 
          DATE_TRUNC('month', "createdAt") as month,
          SUM(tax) as total_tax,
          COUNT(*) as transactions
        FROM "Sale"
        WHERE ${storeIdValue ? Prisma.sql`"storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND "createdAt" >= ${start}
          AND "createdAt" <= ${end}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY month DESC
      `,

            // Payment method breakdown
            prisma.sale.groupBy({
                by: ['paymentMethod'],
                where: {
                    ...storeFilter,
                    createdAt: { gte: start, lte: end }
                },
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            }),

            // Daily revenue trend
            prisma.$queryRaw<any>`
        SELECT 
          DATE("createdAt") as date,
          SUM(total) as daily_revenue,
          SUM(subtotal) as daily_subtotal,
          SUM(tax) as daily_tax,
          COUNT(*) as transactions,
          AVG(total) as avg_transaction
        FROM "Sale"
        WHERE ${storeIdValue ? Prisma.sql`"storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND "createdAt" >= ${start}
          AND "createdAt" <= ${end}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,

            // Product performance by revenue
            prisma.$queryRaw<any>`
        SELECT 
          p.id,
          p.name,
          p.type,
          p."basePrice",
          SUM(si.quantity) as total_quantity,
          SUM(si.quantity * si.price) as total_revenue,
          SUM(si.quantity * p."basePrice") as total_cost,
          (SUM(si.quantity * si.price) - SUM(si.quantity * p."basePrice")) as total_profit,
          COUNT(DISTINCT si."saleId") as sales_count
        FROM "SaleItem" si
        JOIN "Product" p ON p.id = si."productId"
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
        GROUP BY p.id, p.name, p.type, p."basePrice"
        ORDER BY total_profit DESC
        LIMIT 15
      `,

            // Voided sales summary
            prisma.voidedSale.aggregate({
                where: {
                    sale: storeFilter,
                    createdAt: { gte: start, lte: end }
                },
                _sum: { originalTotal: true },
                _count: true
            })
        ]);

        // Calculate profitability
        const totalCost = (expenseSummary as ExpenseSummaryItem[]).reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
        const totalRevenue = revenueSummary._sum.total || 0;
        const totalTax = revenueSummary._sum.tax || 0;
        const grossProfit = totalRevenue - totalCost;
        const netProfit = grossProfit - totalTax;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        // Calculate inventory turnover
        const inventoryTurnover = await prisma.$queryRaw<InventoryTurnoverItem[]>`
      SELECT 
        AVG(daily_sales.quantity_sold) as avg_daily_sales,
        AVG(inventory.avg_stock) as avg_inventory
      FROM (
        SELECT 
          DATE(s."createdAt") as date,
          SUM(si.quantity) as quantity_sold
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
        GROUP BY DATE(s."createdAt")
      ) daily_sales,
      (
        SELECT 
          AVG(i.quantity) as avg_stock
        FROM "Inventory" i
        WHERE ${storeIdValue ? Prisma.sql`i."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
      ) inventory
    `;

        const turnoverRatio = inventoryTurnover[0]?.avg_inventory > 0 ?
            ((inventoryTurnover[0]?.avg_daily_sales || 0) * 30) / (inventoryTurnover[0]?.avg_inventory || 1) : 0;

        res.json({
            period: { start, end },
            revenue: {
                total: totalRevenue,
                subtotal: revenueSummary._sum.subtotal || 0,
                tax: totalTax,
                transactions: revenueSummary._count,
                averageTransaction: revenueSummary._avg.total || 0
            },
            expenses: {
                total: totalCost,
                categories: expenseSummary
            },
            profitability: {
                grossProfit,
                netProfit,
                profitMargin,
                marginPercentage: profitMargin.toFixed(2) + '%'
            },
            taxes: taxSummary,
            paymentMethods: (paymentMethods as any[]).reduce((acc, method) => {
                acc[method.paymentMethod] = {
                    total: method._sum.total || 0,
                    count: method._count,
                    average: method._avg.total || 0
                };
                return acc;
            }, {} as Record<string, any>),
            dailyRevenue,
            productPerformance,
            voidedSales: {
                totalAmount: voidedSummary._sum.originalTotal || 0,
                count: voidedSummary._count,
                percentage: revenueSummary._count > 0 ?
                    (voidedSummary._count / revenueSummary._count) * 100 : 0
            },
            inventoryMetrics: {
                turnoverRatio,
                avgDailySales: inventoryTurnover[0]?.avg_daily_sales || 0,
                avgInventory: inventoryTurnover[0]?.avg_inventory || 0
            },
            financialHealth: {
                liquidityScore: profitMargin > 20 ? 'EXCELLENT' : profitMargin > 10 ? 'GOOD' : profitMargin > 0 ? 'FAIR' : 'POOR',
                efficiencyScore: turnoverRatio > 2 ? 'EXCELLENT' : turnoverRatio > 1 ? 'GOOD' : 'FAIR',
                riskScore: voidedSummary._count > 10 ? 'HIGH' : voidedSummary._count > 5 ? 'MEDIUM' : 'LOW'
            }
        });
    } catch (error) {
        console.error("Get financial summary error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getInventoryDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && (!user || user.role !== 'ADMIN')) {
            storeFilter = { storeId: storeIdValue };
        }

        // Get inventory data
        const [
            inventorySummary,
            lowStockItems,
            recentMovements,
            topProducts,
            storeComparison,
            centralInventory
        ] = await Promise.all([
            // Inventory summary
            prisma.inventory.aggregate({
                where: storeFilter,
                _sum: { quantity: true },
                _count: true,
                _avg: { quantity: true, storePrice: true }
            }),

            // Low stock items
            prisma.inventory.findMany({
                where: {
                    ...storeFilter,
                    quantity: { lt: prisma.inventory.fields.reorderLevel }
                },
                include: {
                    product: true,
                    store: true
                },
                orderBy: { quantity: 'asc' },
                take: 10
            }),

            // Recent inventory movements
            prisma.inventoryHistory.findMany({
                where: {
                    inventory: storeFilter
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                    inventory: {
                        include: {
                            product: true,
                            store: true
                        }
                    },
                    user: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    }
                }
            }),

            // Top products by value
            prisma.$queryRaw<any>`
        SELECT 
          p.id,
          p.name,
          p.type,
          p.grade,
          p."basePrice",
          i.quantity,
          i."storePrice",
          (i.quantity * COALESCE(i."storePrice", p."basePrice")) as total_value,
          i."reorderLevel",
          i."optimalLevel",
          CASE 
            WHEN i.quantity < COALESCE(i."reorderLevel", 10) THEN 'LOW_STOCK'
            WHEN i.quantity > COALESCE(i."optimalLevel", 50) THEN 'HIGH_STOCK'
            ELSE 'OPTIMAL'
          END as stock_status
        FROM "Inventory" i
        JOIN "Product" p ON p.id = i."productId"
        WHERE ${storeIdValue ? Prisma.sql`i."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
        ORDER BY total_value DESC
        LIMIT 10
      `,

            // Store comparison (for admins)
            user?.role === 'ADMIN' ? prisma.$queryRaw<any>`
        SELECT 
          s.id,
          s.name,
          s.location,
          COUNT(i.id) as product_count,
          SUM(i.quantity) as total_quantity,
          SUM(i.quantity * COALESCE(i."storePrice", p."basePrice")) as total_value,
          COUNT(CASE WHEN i.quantity < COALESCE(i."reorderLevel", 10) THEN 1 END) as low_stock_items,
          AVG(i.quantity) as avg_quantity
        FROM "Inventory" i
        JOIN "Product" p ON p.id = i."productId"
        JOIN "Store" s ON s.id = i."storeId"
        GROUP BY s.id, s.name, s.location
        ORDER BY total_value DESC
      ` : Promise.resolve([]),

            // Central inventory overview (for admins)
            user?.role === 'ADMIN' ? prisma.$queryRaw<any>`
        SELECT 
          ci."productId",
          p.name,
          p.type,
          ci.total_quantity,
          ci.allocated,
          ci.available,
          ci.reserved,
          ci."reorderLevel",
          ci."optimalLevel",
          CASE 
            WHEN ci.available < COALESCE(ci."reorderLevel", 50) THEN 'LOW_STOCK'
            WHEN ci.available > COALESCE(ci."optimalLevel", 200) THEN 'HIGH_STOCK'
            ELSE 'OPTIMAL'
          END as stock_status
        FROM "CentralInventory" ci
        JOIN "Product" p ON p.id = ci."productId"
        ORDER BY ci.available ASC
        LIMIT 15
      ` : Promise.resolve([])
        ]);

        // Calculate inventory value
        const inventoryValue = await prisma.$queryRaw<InventoryValueItem[]>`
      SELECT 
        SUM(i.quantity * COALESCE(i."storePrice", p."basePrice")) as total_value
      FROM "Inventory" i
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${storeIdValue ? Prisma.sql`i."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
    `;

        // Get movement summary
        const movementSummary = await prisma.inventoryHistory.groupBy({
            by: ['changeType'],
            where: {
                inventory: storeFilter,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
            },
            _sum: { quantityChange: true },
            _count: true
        });

        const inventoryValueData = inventoryValue[0];
        const inventoryQuantity = inventorySummary._sum.quantity || 0;

        res.json({
            summary: {
                totalItems: inventorySummary._count,
                totalQuantity: inventoryQuantity,
                averageQuantity: inventorySummary._avg.quantity || 0,
                averagePrice: inventorySummary._avg.storePrice || 0,
                totalValue: inventoryValueData?.total_value || 0,
                lowStockCount: lowStockItems.length
            },
            lowStockItems,
            recentMovements,
            topProducts,
            movementSummary: movementSummary.reduce((acc, movement) => {
                acc[movement.changeType] = {
                    quantityChange: movement._sum.quantityChange || 0,
                    count: movement._count
                };
                return acc;
            }, {} as Record<string, any>),
            storeComparison,
            centralInventory,
            metrics: {
                inventoryTurnover: inventoryQuantity > 0 ?
                    (movementSummary.find(m => m.changeType === 'SALE')?._sum.quantityChange || 0) / inventoryQuantity * 100 : 0,
                stockCoverage: inventoryQuantity > 0 ?
                    inventoryQuantity / (movementSummary.find(m => m.changeType === 'SALE')?._sum.quantityChange || 1) : 0,
                healthScore: 100 - (lowStockItems.length / inventorySummary._count * 100)
            }
        });
    } catch (error) {
        console.error("Get inventory dashboard error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeeDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, period = '30d' } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && (!user || user.role !== 'ADMIN')) {
            storeFilter = { storeId: storeIdValue };
        }

        // Calculate date range
        const endDate = new Date();
        let startDate = new Date();

        switch (period) {
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                break;
            case '90d':
                startDate.setDate(startDate.getDate() - 90);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 30);
        }

        // Get employee data
        const [
            employeeStats,
            topPerformers,
            recentReviews,
            attendanceSummary,
            departmentStats,
            performanceTrend
        ] = await Promise.all([
            // Employee statistics
            prisma.employee.aggregate({
                where: {
                    ...storeFilter,
                    status: 'ACTIVE'
                },
                _count: true,
                // Remove _avg if hireDate is not a number field
            }),

            // Top performing employees
            prisma.$queryRaw<any>`
        SELECT 
          e.id,
          u."firstName" || ' ' || u."lastName" as employee_name,
          e.position,
          e.role,
          e."hireDate",
          COUNT(s.id) as sales_count,
          SUM(s.total) as total_revenue,
          AVG(s.total) as avg_sale_amount,
          COUNT(DISTINCT s."customerName") as unique_customers,
          COUNT(DISTINCT pr.id) as review_count,
          AVG(pr.score) as avg_review_score
        FROM "Employee" e
        JOIN "User" u ON u.id = e."userId"
        LEFT JOIN "Sale" s ON s."employeeId" = e.id
          AND s."createdAt" >= ${startDate}
          AND s."createdAt" <= ${endDate}
        LEFT JOIN "PerformanceReview" pr ON pr."employeeId" = e.id
        WHERE ${storeIdValue ? Prisma.sql`e."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND e.status = 'ACTIVE'
        GROUP BY e.id, u."firstName", u."lastName", e.position, e.role, e."hireDate"
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT 10
      `,

            // Recent performance reviews
            prisma.performanceReview.findMany({
                where: {
                    employee: storeFilter
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
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
                    reviewer: {
                        select: {
                            firstName: true,
                            lastName: true,
                            role: true
                        }
                    }
                }
            }),

            // Attendance/activity summary (simplified)
            prisma.$queryRaw<any>`
        SELECT 
          DATE(a."createdAt") as date,
          COUNT(DISTINCT a."userId") as active_employees,
          COUNT(*) as total_activities,
          COUNT(CASE WHEN a.action = 'LOGIN' THEN 1 END) as logins,
          COUNT(CASE WHEN a.action = 'SALE_CREATED' THEN 1 END) as sales_created,
          COUNT(CASE WHEN a.action = 'TRANSFER_COMPLETED' THEN 1 END) as transfers_completed
        FROM "ActivityLog" a
        JOIN "User" u ON u.id = a."userId"
        JOIN "Employee" e ON e."userId" = u.id
        WHERE ${storeIdValue ? Prisma.sql`e."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND a."createdAt" >= ${startDate}
          AND a."createdAt" <= ${endDate}
        GROUP BY DATE(a."createdAt")
        ORDER BY date DESC
        LIMIT 14
      `,

            // Department/role statistics
            prisma.employee.groupBy({
                by: ['role'],
                where: {
                    ...storeFilter,
                    status: 'ACTIVE'
                },
                _count: true,
                // Remove _avg if hireDate is not a number field
            }),

            // Performance trend
            prisma.$queryRaw<any>`
        SELECT 
          DATE_TRUNC('week', pr."createdAt") as week,
          AVG(pr.score) as avg_score,
          COUNT(pr.id) as review_count,
          COUNT(DISTINCT pr."employeeId") as employees_reviewed
        FROM "PerformanceReview" pr
        JOIN "Employee" e ON e.id = pr."employeeId"
        WHERE ${storeIdValue ? Prisma.sql`e."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
          AND pr."createdAt" >= ${startDate}
          AND pr."createdAt" <= ${endDate}
        GROUP BY DATE_TRUNC('week', pr."createdAt")
        ORDER BY week DESC
        LIMIT 8
      `
        ]);

        // Calculate additional metrics
        const turnoverRate = await prisma.$queryRaw<TurnoverRateItem[]>`
      SELECT 
        COUNT(CASE WHEN e.status = 'TERMINATED' AND e."terminationDate" >= ${startDate} THEN 1 END) as terminated_count,
        COUNT(CASE WHEN e.status = 'ACTIVE' THEN 1 END) as active_count
      FROM "Employee" e
      WHERE ${storeIdValue ? Prisma.sql`e."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
    `;

        const avgTenure = await prisma.$queryRaw<AvgTenureItem[]>`
      SELECT 
        AVG(EXTRACT(DAY FROM (NOW() - e."hireDate"))) as avg_tenure_days
      FROM "Employee" e
      WHERE ${storeIdValue ? Prisma.sql`e."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
        AND e.status = 'ACTIVE'
    `;

        const turnoverRateData = turnoverRate[0];
        const avgTenureData = avgTenure[0];
        const topPerformersData = topPerformers as any[];
        const attendanceSummaryData = attendanceSummary as any[];

        res.json({
            period: { startDate, endDate, period },
            employeeStats: {
                totalActive: employeeStats._count,
                turnoverRate: turnoverRateData?.active_count > 0 ?
                    (turnoverRateData?.terminated_count || 0) / turnoverRateData.active_count * 100 : 0,
                avgTenure: avgTenureData?.avg_tenure_days || 0,
                departmentBreakdown: (departmentStats as any[]).reduce((acc, dept) => {
                    acc[dept.role] = dept._count;
                    return acc;
                }, {} as Record<string, number>)
            },
            topPerformers: topPerformersData,
            recentReviews,
            attendanceSummary: attendanceSummaryData,
            performanceTrend,
            metrics: {
                avgSalesPerEmployee: employeeStats._count > 0 ?
                    topPerformersData.reduce((sum: number, emp: any) => sum + (emp.sales_count || 0), 0) / employeeStats._count : 0,
                avgReviewScore: recentReviews.length > 0 ?
                    recentReviews.reduce((sum, review) => sum + review.score, 0) / recentReviews.length : 0,
                engagementScore: attendanceSummaryData.length > 0 ?
                    attendanceSummaryData.reduce((sum: number, day: any) => sum + (day.active_employees || 0), 0) / attendanceSummaryData.length / employeeStats._count * 100 : 0
            }
        });
    } catch (error) {
        console.error("Get employee dashboard error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};