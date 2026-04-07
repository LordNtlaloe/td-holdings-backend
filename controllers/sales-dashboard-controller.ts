// controllers/sales-dashboard-controller.ts
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { Prisma } from "../prisma/generated/client";

export const getSalesDashboardSummary = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, date } = req.query;
        const user = (req as any).user;

        const today = date ? new Date(date as string) : new Date();

        // Set date ranges
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - 7);

        const startOfMonth = new Date(today);
        startOfMonth.setMonth(today.getMonth() - 1);

        const startOfLastWeek = new Date(startOfWeek);
        startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

        const startOfLastMonth = new Date(startOfMonth);
        startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Get today's stats
        const todayStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: { gte: startOfDay, lte: endOfDay }
            },
            _count: { id: true },
            _sum: { total: true }
        });

        // Get this week's stats
        const weekStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: { gte: startOfWeek }
            },
            _count: { id: true },
            _sum: { total: true }
        });

        // Get last week's stats for growth
        const lastWeekStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: {
                    gte: startOfLastWeek,
                    lt: startOfWeek
                }
            },
            _sum: { total: true }
        });

        // Get this month's stats
        const monthStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: { gte: startOfMonth }
            },
            _count: { id: true },
            _sum: { total: true }
        });

        // Get last month's stats for growth
        const lastMonthStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: {
                    gte: startOfLastMonth,
                    lt: startOfMonth
                }
            },
            _sum: { total: true }
        });

        // Get pending voids count (today)
        const pendingVoids = await prisma.voidedSale.count({
            where: {
                sale: storeFilter,
                createdAt: { gte: startOfDay }
            }
        });

        // Get low stock alerts count
        const lowStockAlerts = await prisma.inventory.count({
            where: {
                ...storeFilter,
                quantity: { lt: prisma.inventory.fields.reorderLevel }
            }
        });

        // Calculate average ticket
        const averageTicket = todayStats._count.id > 0
            ? (todayStats._sum.total || 0) / todayStats._count.id
            : 0;

        // Calculate growth percentages
        const weekGrowth = lastWeekStats._sum.total && lastWeekStats._sum.total > 0
            ? (((weekStats._sum.total || 0) - lastWeekStats._sum.total) / lastWeekStats._sum.total) * 100
            : 0;

        const monthGrowth = lastMonthStats._sum.total && lastMonthStats._sum.total > 0
            ? (((monthStats._sum.total || 0) - lastMonthStats._sum.total) / lastMonthStats._sum.total) * 100
            : 0;

        res.json({
            today: {
                sales: todayStats._count.id || 0,
                revenue: todayStats._sum.total || 0,
                transactions: todayStats._count.id || 0,
                averageTicket: Number(averageTicket.toFixed(2))
            },
            week: {
                sales: weekStats._count.id || 0,
                revenue: weekStats._sum.total || 0,
                growth: Number(weekGrowth.toFixed(1))
            },
            month: {
                sales: monthStats._count.id || 0,
                revenue: monthStats._sum.total || 0,
                growth: Number(monthGrowth.toFixed(1))
            },
            pendingVoids: pendingVoids,
            lowStockAlerts: lowStockAlerts
        });
    } catch (error) {
        console.error("Get sales dashboard summary error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getRecentActivity = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, limit = 10 } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Get recent sales
        const recentSales = await prisma.sale.findMany({
            where: storeFilter,
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
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
                store: true,
                voidedSale: true
            }
        });

        // Get recent voids
        const recentVoids = await prisma.voidedSale.findMany({
            where: {
                sale: storeFilter
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            include: {
                sale: {
                    include: {
                        store: true
                    }
                }
            }
        });

        // Combine and format activities
        const activities = [
            ...recentSales.map(sale => ({
                id: sale.id,
                type: sale.voidedSale ? 'VOID' : 'SALE',
                amount: sale.total,
                customer: sale.customerName || 'Guest',
                employee: `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                timestamp: sale.createdAt,
                store: sale.store.name
            })),
            ...recentVoids.map(voided => ({
                id: voided.id,
                type: 'VOID',
                amount: voided.originalTotal,
                customer: voided.sale.customerName || 'Guest',
                employee: 'System', // You might want to track who voided it
                timestamp: voided.createdAt,
                store: voided.sale.store.name
            }))
        ];

        // Sort by timestamp descending and limit
        activities.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        res.json(activities.slice(0, Number(limit)));
    } catch (error) {
        console.error("Get recent activity error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getTopProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, period = 'week', limit = 10 } = req.query;
        const user = (req as any).user;

        // Calculate date range based on period
        const endDate = new Date();
        let startDate = new Date();

        switch (period) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 7);
        }

        // Apply store filter
        const storeIdValue = storeId as string || user?.storeId;

        // Get top products by revenue
        const topProducts = await prisma.$queryRaw<any[]>`
            SELECT 
                p.id,
                p.name,
                p.type,
                p.grade,
                SUM(si.quantity) as quantity,
                SUM(si.quantity * si.price) as revenue,
                COUNT(DISTINCT si."saleId") as sales_count
            FROM "SaleItem" si
            JOIN "Product" p ON p.id = si."productId"
            JOIN "Sale" s ON s.id = si."saleId"
            WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                AND s."createdAt" >= ${startDate}
                AND s."createdAt" <= ${endDate}
            GROUP BY p.id, p.name, p.type, p.grade
            ORDER BY revenue DESC
            LIMIT ${Number(limit)}
        `;

        // Format the response
        const formattedProducts = topProducts.map(product => ({
            id: product.id,
            name: product.name,
            quantity: Number(product.quantity),
            revenue: Number(product.revenue),
            image: product.image || undefined
        }));

        res.json(formattedProducts);
    } catch (error) {
        console.error("Get top products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getStorePerformance = async (req: Request, res: Response): Promise<void> => {
    try {
        const { date } = req.query;
        const user = (req as any).user;

        // Only admins and managers can see all stores
        if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') {
            res.status(403).json({ error: "Unauthorized to view store performance" });
            return;
        }

        const targetDate = date ? new Date(date as string) : new Date();
        const startOfMonth = new Date(targetDate);
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const endOfMonth = new Date(targetDate);
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);
        endOfMonth.setDate(0);
        endOfMonth.setHours(23, 59, 59, 999);

        // Get store performance
        const storePerformance = await prisma.$queryRaw<any[]>`
            SELECT 
                s.id as "storeId",
                s.name as "storeName",
                COUNT(DISTINCT sa.id) as sales,
                COALESCE(SUM(sa.total), 0) as revenue,
                COUNT(DISTINCT sa.id) as transactions,
                COUNT(DISTINCT e.id) as employees,
                COALESCE((
                    SELECT COUNT(DISTINCT sa2."employeeId") 
                    FROM "Sale" sa2 
                    WHERE sa2."storeId" = s.id 
                        AND sa2."createdAt" >= ${startOfMonth}
                        AND sa2."createdAt" <= ${endOfMonth}
                ), 0) as active_employees,
                CASE 
                    WHEN COUNT(DISTINCT sa.id) > 0 
                    THEN (COUNT(DISTINCT sa.id)::float / NULLIF((
                        SELECT COUNT(DISTINCT sa2.id)
                        FROM "Sale" sa2
                        WHERE sa2."storeId" = s.id
                            AND sa2."createdAt" >= ${startOfMonth}
                            AND sa2."createdAt" <= ${endOfMonth}
                    ), 0) * 100)
                    ELSE 0
                END as achievement
            FROM "Store" s
            LEFT JOIN "Sale" sa ON sa."storeId" = s.id
                AND sa."createdAt" >= ${startOfMonth}
                AND sa."createdAt" <= ${endOfMonth}
            LEFT JOIN "Employee" e ON e."storeId" = s.id
            GROUP BY s.id, s.name
            ORDER BY revenue DESC
        `;

        // Add target (you might want to get this from a targets table)
        const performanceWithTargets = storePerformance.map(store => ({
            ...store,
            target: Math.round(store.revenue * 1.1), // Example: target is 10% above current
            achievement: Number(store.achievement.toFixed(1))
        }));

        res.json(performanceWithTargets);
    } catch (error) {
        console.error("Get store performance error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getRealtimeUpdates = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, since } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        const sinceDate = since ? new Date(since as string) : new Date(Date.now() - 5 * 60 * 1000); // Last 5 minutes default

        // Get new sales since timestamp
        const newSales = await prisma.sale.findMany({
            where: {
                ...storeFilter,
                createdAt: { gt: sinceDate }
            },
            orderBy: { createdAt: 'desc' },
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
                }
            }
        });

        // Get updated sales (voided, etc)
        const updatedSales = await prisma.voidedSale.findMany({
            where: {
                sale: storeFilter,
                createdAt: { gt: sinceDate }
            },
            include: {
                sale: true
            }
        });

        // Calculate new revenue
        const newRevenue = newSales.reduce((sum, sale) => sum + sale.total, 0);

        res.json({
            newSales: newSales.length,
            updatedSales: updatedSales.map(v => v.saleId),
            revenue: newRevenue,
            timestamp: new Date(),
            sales: newSales // Include the actual sales data if needed
        });
    } catch (error) {
        console.error("Get realtime updates error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSalesByHour = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, date } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        const targetDate = date ? new Date(date as string) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        // Get sales grouped by hour
        const salesByHour = await prisma.$queryRaw<any[]>`
            SELECT 
                EXTRACT(HOUR FROM s."createdAt") as hour,
                COUNT(*) as sales,
                COALESCE(SUM(s.total), 0) as revenue,
                COUNT(*) as transactions
            FROM "Sale" s
            WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                AND s."createdAt" >= ${startOfDay}
                AND s."createdAt" <= ${endOfDay}
            GROUP BY EXTRACT(HOUR FROM s."createdAt")
            ORDER BY hour ASC
        `;

        // Create array for all 24 hours
        const hourlyData = [];
        for (let i = 0; i < 24; i++) {
            const existing = salesByHour.find(item => Number(item.hour) === i);
            hourlyData.push({
                hour: i,
                sales: existing ? Number(existing.sales) : 0,
                revenue: existing ? Number(existing.revenue) : 0,
                transactions: existing ? Number(existing.transactions) : 0
            });
        }

        res.json(hourlyData);
    } catch (error) {
        console.error("Get sales by hour error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// controllers/sales-dashboard-controller.ts (add these new endpoints)

export const getSalesByDay = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, startDate, endDate } = req.query;
        const user = (req as any).user;

        // Default to last 30 days if no dates provided
        const end = endDate ? new Date(endDate as string) : new Date();
        const start = startDate ? new Date(startDate as string) : new Date();
        if (!startDate) {
            start.setDate(start.getDate() - 30);
        }

        // Set time boundaries
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Get sales grouped by day
        const salesByDay = await prisma.$queryRaw<any[]>`
            SELECT 
                DATE(s."createdAt") as date,
                COUNT(*) as sales,
                COALESCE(SUM(s.total), 0) as revenue,
                COUNT(*) as transactions,
                COALESCE(AVG(s.total), 0) as average_ticket
            FROM "Sale" s
            WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                AND s."createdAt" >= ${start}
                AND s."createdAt" <= ${end}
            GROUP BY DATE(s."createdAt")
            ORDER BY date ASC
        `;

        // Get comparison with previous period (same length, before start date)
        const previousStart = new Date(start);
        previousStart.setDate(previousStart.getDate() - (Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))));
        const previousEnd = new Date(start);
        previousEnd.setDate(previousEnd.getDate() - 1);
        previousEnd.setHours(23, 59, 59, 999);

        const previousPeriodStats = await prisma.sale.aggregate({
            where: {
                ...storeFilter,
                createdAt: {
                    gte: previousStart,
                    lte: previousEnd
                }
            },
            _sum: { total: true },
            _count: { id: true }
        });

        // Calculate totals and trends
        const totalRevenue = salesByDay.reduce((sum, day) => sum + Number(day.revenue), 0);
        const totalTransactions = salesByDay.reduce((sum, day) => sum + Number(day.sales), 0);
        const previousRevenue = previousPeriodStats._sum.total || 0;
        const previousTransactions = previousPeriodStats._count.id || 0;

        const revenueGrowth = previousRevenue > 0
            ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
            : 0;

        const transactionGrowth = previousTransactions > 0
            ? ((totalTransactions - previousTransactions) / previousTransactions) * 100
            : 0;

        // Format response
        const formattedData = salesByDay.map(day => ({
            date: day.date,
            sales: Number(day.sales),
            revenue: Number(day.revenue),
            transactions: Number(day.transactions),
            averageTicket: Number(day.average_ticket)
        }));

        res.json({
            period: {
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0],
                days: formattedData.length
            },
            data: formattedData,
            summary: {
                totalRevenue,
                totalTransactions,
                averageDailyRevenue: totalRevenue / formattedData.length || 0,
                averageDailyTransactions: totalTransactions / formattedData.length || 0,
                averageTicket: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
                growth: {
                    revenue: Number(revenueGrowth.toFixed(1)),
                    transactions: Number(transactionGrowth.toFixed(1))
                }
            }
        });
    } catch (error) {
        console.error("Get sales by day error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSalesByWeek = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, year, month } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Determine date range
        let startDate: Date;
        let endDate: Date;

        if (year && month) {
            // Get specific month's weeks
            const targetYear = parseInt(year as string);
            const targetMonth = parseInt(month as string) - 1; // JS months are 0-indexed
            startDate = new Date(targetYear, targetMonth, 1);
            endDate = new Date(targetYear, targetMonth + 1, 0);
        } else {
            // Default to last 12 weeks
            endDate = new Date();
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 84); // 12 weeks
        }

        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // Get sales grouped by week
        const salesByWeek = await prisma.$queryRaw<any[]>`
            WITH weeks AS (
                SELECT 
                    DATE_TRUNC('week', s."createdAt") as week_start,
                    DATE_TRUNC('week', s."createdAt") + INTERVAL '6 days' as week_end,
                    COUNT(*) as sales,
                    COALESCE(SUM(s.total), 0) as revenue,
                    COUNT(DISTINCT s.id) as transactions,
                    COUNT(DISTINCT s."employeeId") as active_employees
                FROM "Sale" s
                WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                    AND s."createdAt" >= ${startDate}
                    AND s."createdAt" <= ${endDate}
                GROUP BY DATE_TRUNC('week', s."createdAt")
            )
            SELECT 
                week_start,
                week_end,
                sales,
                revenue,
                transactions,
                active_employees,
                CASE 
                    WHEN LAG(revenue) OVER (ORDER BY week_start) > 0 
                    THEN ((revenue - LAG(revenue) OVER (ORDER BY week_start)) / LAG(revenue) OVER (ORDER BY week_start)) * 100
                    ELSE 0
                END as week_over_week_growth
            FROM weeks
            ORDER BY week_start ASC
        `;

        // Calculate totals and averages
        const totalRevenue = salesByWeek.reduce((sum, week) => sum + Number(week.revenue), 0);
        const totalTransactions = salesByWeek.reduce((sum, week) => sum + Number(week.sales), 0);
        const averageWeeklyRevenue = totalRevenue / salesByWeek.length || 0;

        // Calculate year-over-year comparison if we have full year data
        let yearOverYearGrowth = 0;
        if (salesByWeek.length >= 52) {
            const currentYearRevenue = salesByWeek.slice(-26).reduce((sum, week) => sum + Number(week.revenue), 0);
            const previousYearRevenue = salesByWeek.slice(0, 26).reduce((sum, week) => sum + Number(week.revenue), 0);
            yearOverYearGrowth = previousYearRevenue > 0
                ? ((currentYearRevenue - previousYearRevenue) / previousYearRevenue) * 100
                : 0;
        }

        // Format response
        const formattedData = salesByWeek.map(week => ({
            weekStart: week.week_start,
            weekEnd: week.week_end,
            weekNumber: getWeekNumber(new Date(week.week_start)),
            sales: Number(week.sales),
            revenue: Number(week.revenue),
            transactions: Number(week.transactions),
            activeEmployees: Number(week.active_employees),
            averageTicket: Number(week.sales) > 0 ? Number(week.revenue) / Number(week.sales) : 0,
            weekOverWeekGrowth: Number(week.week_over_week_growth).toFixed(1)
        }));

        res.json({
            period: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
                weeks: formattedData.length
            },
            data: formattedData,
            summary: {
                totalRevenue,
                totalTransactions,
                averageWeeklyRevenue,
                averageWeeklyTransactions: totalTransactions / formattedData.length || 0,
                averageTicket: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
                yearOverYearGrowth: Number(yearOverYearGrowth.toFixed(1))
            }
        });
    } catch (error) {
        console.error("Get sales by week error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSalesByMonth = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, years = 2 } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Set date range for last X years
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - Number(years));
        startDate.setMonth(0, 1); // Start from January
        startDate.setHours(0, 0, 0, 0);

        // Get sales grouped by month
        const salesByMonth = await prisma.$queryRaw<any[]>`
            WITH monthly_sales AS (
                SELECT 
                    DATE_TRUNC('month', s."createdAt") as month,
                    EXTRACT(YEAR FROM s."createdAt") as year,
                    EXTRACT(MONTH FROM s."createdAt") as month_number,
                    COUNT(*) as sales,
                    COALESCE(SUM(s.total), 0) as revenue,
                    COUNT(DISTINCT s.id) as transactions,
                    COUNT(DISTINCT s."employeeId") as active_employees,
                    COUNT(DISTINCT s."customerId") as unique_customers
                FROM "Sale" s
                WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                    AND s."createdAt" >= ${startDate}
                    AND s."createdAt" <= ${endDate}
                GROUP BY DATE_TRUNC('month', s."createdAt"), 
                         EXTRACT(YEAR FROM s."createdAt"),
                         EXTRACT(MONTH FROM s."createdAt")
            )
            SELECT 
                month,
                year,
                month_number,
                sales,
                revenue,
                transactions,
                active_employees,
                unique_customers,
                CASE 
                    WHEN LAG(revenue) OVER (ORDER BY month) > 0 
                    THEN ((revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month)) * 100
                    ELSE 0
                END as month_over_month_growth,
                AVG(revenue) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) as moving_avg_3months
            FROM monthly_sales
            ORDER BY month ASC
        `;

        // Calculate year-by-year comparison
        const yearlyData = salesByMonth.reduce((acc: any, month) => {
            const year = month.year;
            if (!acc[year]) {
                acc[year] = {
                    year,
                    revenue: 0,
                    transactions: 0,
                    months: 0
                };
            }
            acc[year].revenue += Number(month.revenue);
            acc[year].transactions += Number(month.sales);
            acc[year].months++;
            return acc;
        }, {});

        const yearlyComparison = Object.values(yearlyData).map((year: any) => ({
            ...year,
            averageMonthlyRevenue: year.revenue / year.months,
            averageTicket: year.transactions > 0 ? year.revenue / year.transactions : 0
        }));

        // Calculate totals
        const totalRevenue = salesByMonth.reduce((sum, month) => sum + Number(month.revenue), 0);
        const totalTransactions = salesByMonth.reduce((sum, month) => sum + Number(month.sales), 0);

        // Format response
        const formattedData = salesByMonth.map(month => ({
            month: month.month,
            year: Number(month.year),
            monthNumber: Number(month.month_number),
            monthName: new Date(month.month).toLocaleString('default', { month: 'long' }),
            sales: Number(month.sales),
            revenue: Number(month.revenue),
            transactions: Number(month.transactions),
            activeEmployees: Number(month.active_employees),
            uniqueCustomers: Number(month.unique_customers),
            averageTicket: Number(month.sales) > 0 ? Number(month.revenue) / Number(month.sales) : 0,
            monthOverMonthGrowth: Number(month.month_over_month_growth).toFixed(1),
            movingAverage3Months: Number(month.moving_avg_3months)
        }));

        res.json({
            period: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
                months: formattedData.length,
                years: Number(years)
            },
            data: formattedData,
            yearlyComparison,
            summary: {
                totalRevenue,
                totalTransactions,
                averageMonthlyRevenue: totalRevenue / formattedData.length || 0,
                averageMonthlyTransactions: totalTransactions / formattedData.length || 0,
                averageTicket: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
            }
        });
    } catch (error) {
        console.error("Get sales by month error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSalesByYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId, startYear, endYear } = req.query;
        const user = (req as any).user;

        // Apply store filter
        let storeFilter: any = {};
        const storeIdValue = storeId as string || user?.storeId;
        if (storeIdValue && user?.role !== 'ADMIN') {
            storeFilter = { storeId: storeIdValue };
        }

        // Set date range
        const currentYear = new Date().getFullYear();
        const start = startYear ? parseInt(startYear as string) : currentYear - 5;
        const end = endYear ? parseInt(endYear as string) : currentYear;

        const startDate = new Date(start, 0, 1);
        const endDate = new Date(end, 11, 31, 23, 59, 59, 999);

        // Get sales grouped by year
        const salesByYear = await prisma.$queryRaw<any[]>`
            WITH yearly_sales AS (
                SELECT 
                    EXTRACT(YEAR FROM s."createdAt") as year,
                    COUNT(*) as sales,
                    COALESCE(SUM(s.total), 0) as revenue,
                    COUNT(DISTINCT s.id) as transactions,
                    COUNT(DISTINCT s."customerId") as unique_customers,
                    COUNT(DISTINCT s."employeeId") as active_employees,
                    COUNT(DISTINCT EXTRACT(MONTH FROM s."createdAt")) as active_months
                FROM "Sale" s
                WHERE ${storeIdValue ? Prisma.sql`s."storeId" = ${storeIdValue}` : Prisma.sql`1=1`}
                    AND s."createdAt" >= ${startDate}
                    AND s."createdAt" <= ${endDate}
                GROUP BY EXTRACT(YEAR FROM s."createdAt")
            )
            SELECT 
                year,
                sales,
                revenue,
                transactions,
                unique_customers,
                active_employees,
                active_months,
                CASE 
                    WHEN LAG(revenue) OVER (ORDER BY year) > 0 
                    THEN ((revenue - LAG(revenue) OVER (ORDER BY year)) / LAG(revenue) OVER (ORDER BY year)) * 100
                    ELSE 0
                END as year_over_year_growth
            FROM yearly_sales
            ORDER BY year ASC
        `;

        // Calculate additional metrics
        const totalRevenue = salesByYear.reduce((sum, year) => sum + Number(year.revenue), 0);
        const totalTransactions = salesByYear.reduce((sum, year) => sum + Number(year.sales), 0);
        const averageAnnualRevenue = totalRevenue / salesByYear.length || 0;

        // Calculate CAGR (Compound Annual Growth Rate)
        let cagr = 0;
        if (salesByYear.length >= 2) {
            const firstYearRevenue = Number(salesByYear[0].revenue);
            const lastYearRevenue = Number(salesByYear[salesByYear.length - 1].revenue);
            const years = salesByYear.length - 1;
            cagr = firstYearRevenue > 0 && years > 0
                ? (Math.pow(lastYearRevenue / firstYearRevenue, 1 / years) - 1) * 100
                : 0;
        }

        // Calculate best and worst years
        const bestYear = salesByYear.reduce((best, current) =>
            Number(current.revenue) > Number(best.revenue) ? current : best
            , salesByYear[0]);

        const worstYear = salesByYear.reduce((worst, current) =>
            Number(current.revenue) < Number(worst.revenue) ? current : worst
            , salesByYear[0]);

        // Format response
        const formattedData = salesByYear.map(year => ({
            year: Number(year.year),
            sales: Number(year.sales),
            revenue: Number(year.revenue),
            transactions: Number(year.transactions),
            uniqueCustomers: Number(year.unique_customers),
            activeEmployees: Number(year.active_employees),
            activeMonths: Number(year.active_months),
            averageMonthlyRevenue: Number(year.active_months) > 0
                ? Number(year.revenue) / Number(year.active_months)
                : 0,
            averageTicket: Number(year.sales) > 0
                ? Number(year.revenue) / Number(year.sales)
                : 0,
            yearOverYearGrowth: Number(year.year_over_year_growth).toFixed(1)
        }));

        res.json({
            period: {
                start: start,
                end: end,
                years: salesByYear.length
            },
            data: formattedData,
            summary: {
                totalRevenue,
                totalTransactions,
                averageAnnualRevenue,
                averageAnnualTransactions: totalTransactions / salesByYear.length || 0,
                averageTicket: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
                cagr: Number(cagr.toFixed(1)),
                bestYear: {
                    year: Number(bestYear.year),
                    revenue: Number(bestYear.revenue)
                },
                worstYear: {
                    year: Number(worstYear.year),
                    revenue: Number(worstYear.revenue)
                }
            }
        });
    } catch (error) {
        console.error("Get sales by year error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Helper function to get week number
function getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

export const compareStoreTopProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const { period = 'week', limit = 5, storeIds } = req.query;
        const user = (req as any).user;

        // Only admins and managers can compare stores
        if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') {
            res.status(403).json({ error: "Unauthorized to compare stores" });
            return;
        }

        // Parse store IDs if provided
        const storeIdArray = storeIds ? (storeIds as string).split(',') : [];

        // Calculate date range
        const endDate = new Date();
        let startDate = new Date();
        switch (period) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 7);
        }

        // Build store filter
        let storeFilter = Prisma.sql`1=1`;
        if (storeIdArray.length > 0) {
            storeFilter = Prisma.sql`s."storeId" IN (${Prisma.join(storeIdArray)})`;
        }

        // Get top products for each store
        const storeComparisons = await prisma.$queryRaw<any[]>`
            WITH store_products AS (
                SELECT 
                    s."storeId",
                    st.name as "storeName",
                    p.id as "productId",
                    p.name as "productName",
                    SUM(si.quantity) as quantity_sold,
                    SUM(si.quantity * si.price) as revenue,
                    RANK() OVER (PARTITION BY s."storeId" ORDER BY SUM(si.quantity * si.price) DESC) as revenue_rank,
                    RANK() OVER (PARTITION BY s."storeId" ORDER BY SUM(si.quantity) DESC) as quantity_rank
                FROM "SaleItem" si
                JOIN "Product" p ON p.id = si."productId"
                JOIN "Sale" s ON s.id = si."saleId"
                JOIN "Store" st ON st.id = s."storeId"
                WHERE s."createdAt" >= ${startDate}
                    AND s."createdAt" <= ${endDate}
                    AND ${storeFilter}
                GROUP BY s."storeId", st.name, p.id, p.name
            )
            SELECT 
                "storeId",
                "storeName",
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'productId', "productId",
                        'productName', "productName",
                        'quantitySold', quantity_sold,
                        'revenue', revenue,
                        'revenueRank', revenue_rank,
                        'quantityRank', quantity_rank
                    ) ORDER BY revenue_rank
                ) FILTER (WHERE revenue_rank <= 3) as top_by_revenue,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'productId', "productId",
                        'productName', "productName",
                        'quantitySold', quantity_sold,
                        'revenue', revenue
                    ) ORDER BY quantity_rank
                ) FILTER (WHERE quantity_rank <= 3) as top_by_quantity
            FROM store_products
            GROUP BY "storeId", "storeName"
            ORDER BY "storeName"
        `;

        res.json({
            period,
            dateRange: {
                start: startDate,
                end: endDate
            },
            comparisons: storeComparisons
        });
    } catch (error) {
        console.error("Compare store top products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getTopProductsByStore = async (req: Request, res: Response): Promise<void> => {
    try {
        const { period = 'week', limit = 5 } = req.query;
        const user = (req as any).user;

        // Only admins and managers can see all stores' products
        if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') {
            res.status(403).json({ error: "Unauthorized to view products across all stores" });
            return;
        }

        // Calculate date range based on period
        const endDate = new Date();
        let startDate = new Date();

        switch (period) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 7);
        }

        // Get top products grouped by store
        const topProductsByStore = await prisma.$queryRaw<any[]>`
            WITH store_product_sales AS (
                SELECT 
                    s."storeId",
                    st.name as "storeName",
                    p.id as "productId",
                    p.name as "productName",
                    p.type,
                    p.grade,
                    p."imageUrl",
                    SUM(si.quantity) as quantity,
                    SUM(si.quantity * si.price) as revenue,
                    COUNT(DISTINCT si."saleId") as sales_count,
                    ROW_NUMBER() OVER (PARTITION BY s."storeId" ORDER BY SUM(si.quantity * si.price) DESC) as rank
                FROM "SaleItem" si
                JOIN "Product" p ON p.id = si."productId"
                JOIN "Sale" s ON s.id = si."saleId"
                JOIN "Store" st ON st.id = s."storeId"
                WHERE s."createdAt" >= ${startDate}
                    AND s."createdAt" <= ${endDate}
                GROUP BY s."storeId", st.name, p.id, p.name, p.type, p.grade, p."imageUrl"
            )
            SELECT 
                "storeId",
                "storeName",
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id', "productId",
                        'name', "productName",
                        'type', type,
                        'grade', grade,
                        'image', "imageUrl",
                        'quantity', quantity,
                        'revenue', revenue,
                        'salesCount', sales_count,
                        'rank', rank
                    ) ORDER BY rank
                ) FILTER (WHERE rank <= ${Number(limit)}) as top_products
            FROM store_product_sales
            WHERE rank <= ${Number(limit)}
            GROUP BY "storeId", "storeName"
            ORDER BY "storeName" ASC
        `;

        // Format the response
        const formattedResponse = topProductsByStore.map(store => ({
            storeId: store.storeId,
            storeName: store.storeName,
            topProducts: store.top_products.map((product: any) => ({
                ...product,
                quantity: Number(product.quantity),
                revenue: Number(product.revenue),
                salesCount: Number(product.salesCount)
            }))
        }));

        res.json(formattedResponse);
    } catch (error) {
        console.error("Get top products by store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};