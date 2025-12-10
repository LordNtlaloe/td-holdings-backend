// controllers/dashboard.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';

export class DashboardController extends BaseController {
    // Get main dashboard data
    async getDashboardData(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { storeId, period = 'month' } = req.query;

            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();

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
                case 'year':
                    startDate.setFullYear(startDate.getFullYear() - 1);
                    break;
                default:
                    startDate.setMonth(startDate.getMonth() - 1);
            }

            // Build where clause
            let where: any = {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            };

            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            } else if (storeId) {
                where.storeId = storeId as string;
            }

            // Get all data in parallel for performance
            const [
                salesSummary,
                productStats,
                employeeStats,
                recentActivities,
                dailySalesData,
                productCategoryData,
                topProducts
            ] = await Promise.all([
                // Sales summary
                prisma.sale.aggregate({
                    where,
                    _sum: { total: true },
                    _count: true,
                    _avg: { total: true }
                }),

                // Product stats
                prisma.product.aggregate({
                    where: this.getStoreFilter(user.role, user.storeId, storeId as string),
                    _sum: { quantity: true },
                    _count: true,
                    _avg: { price: true }
                }),

                // Employee stats
                prisma.employee.aggregate({
                    where: { storeId: user.role !== 'ADMIN' ? user.storeId : storeId as string || undefined },
                    _count: true
                }),

                // Recent activities (last 10)
                prisma.activityLog.findMany({
                    where: {
                        userId: user.role === 'ADMIN' ? undefined : user.id,
                        createdAt: { gte: startDate }
                    },
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }),

                // Daily sales data for chart
                this.getDailySalesChartData(user, storeId as string, startDate, endDate),

                // Product category distribution
                this.getProductCategoryData(user, storeId as string),

                // Top selling products
                prisma.saleItem.groupBy({
                    by: ['productId'],
                    where: {
                        sale: where
                    },
                    _sum: {
                        quantity: true,
                        price: true
                    },
                    orderBy: {
                        _sum: {
                            quantity: 'desc'
                        }
                    },
                    take: 10
                })
            ]);

            // Process top products data
            const topProductsWithDetails = await Promise.all(
                topProducts.map(async (item: { productId: any; _sum: { quantity: any; price: any; }; }) => {
                    const product = await prisma.product.findUnique({
                        where: { id: item.productId },
                        select: {
                            name: true,
                            type: true,
                            grade: true,
                            price: true
                        }
                    });
                    return {
                        id: item.productId,
                        name: product?.name || 'Unknown',
                        type: product?.type,
                        grade: product?.grade,
                        currentPrice: product?.price,
                        totalSold: item._sum.quantity,
                        totalRevenue: item._sum.price
                    };
                })
            );

            // Low stock alerts
            const lowStockProducts = await prisma.product.findMany({
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId as string),
                    quantity: { lte: 10 }
                },
                select: {
                    id: true,
                    name: true,
                    quantity: true,
                    price: true,
                    type: true
                },
                orderBy: { quantity: 'asc' },
                take: 5
            });

            res.json({
                summary: {
                    totalRevenue: salesSummary._sum.total || 0,
                    totalSales: salesSummary._count,
                    averageSale: salesSummary._avg.total || 0,
                    totalProducts: productStats._count,
                    totalStock: productStats._sum.quantity || 0,
                    averagePrice: productStats._avg.price || 0,
                    totalEmployees: employeeStats._count
                },
                charts: {
                    dailySales: dailySalesData,
                    productCategories: productCategoryData
                },
                topProducts: topProductsWithDetails,
                lowStockAlerts: lowStockProducts,
                recentActivities
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get dashboard data');
        }
    }

    // Get sales chart data
    async getSalesChartData(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { storeId, period = 'month', groupBy = 'day' } = req.query;

            let startDate = new Date();
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

            const endDate = new Date();

            let salesData;
            if (groupBy === 'day') {
                salesData = await this.getDailySalesChartData(user, storeId as string, startDate, endDate);
            } else if (groupBy === 'week') {
                salesData = await this.getWeeklySalesChartData(user, storeId as string, startDate, endDate);
            } else if (groupBy === 'month') {
                salesData = await this.getMonthlySalesChartData(user, storeId as string, startDate, endDate);
            }

            res.json({
                period,
                groupBy,
                data: salesData,
                dateRange: { start: startDate, end: endDate }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get sales chart data');
        }
    }

    // Get inventory chart data
    async getInventoryChartData(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { storeId } = req.query;

            // Get product counts by type
            const productsByType = await prisma.product.groupBy({
                by: ['type'],
                where: this.getStoreFilter(user.role, user.storeId, storeId as string),
                _count: true,
                _sum: { quantity: true }
            });

            // Get tire categories
            const tireCategories = await prisma.product.groupBy({
                by: ['tireCategory'],
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId as string),
                    type: 'TIRE',
                    tireCategory: { not: null }
                },
                _count: true
            });

            // Get bale categories
            const baleCategories = await prisma.product.groupBy({
                by: ['baleCategory'],
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId as string),
                    type: 'BALE',
                    baleCategory: { not: null }
                },
                _count: true
            });

            // Get products by grade
            const productsByGrade = await prisma.product.groupBy({
                by: ['grade'],
                where: this.getStoreFilter(user.role, user.storeId, storeId as string),
                _count: true
            });

            res.json({
                byType: productsByType.map((item: { type: any; _count: any; _sum: { quantity: any; }; }) => ({
                    type: item.type,
                    count: item._count,
                    totalQuantity: item._sum.quantity
                })),
                tireCategories: tireCategories.map((item: { tireCategory: any; _count: any; }) => ({
                    category: item.tireCategory,
                    count: item._count
                })),
                baleCategories: baleCategories.map((item: { baleCategory: any; _count: any; }) => ({
                    category: item.baleCategory,
                    count: item._count
                })),
                byGrade: productsByGrade.map((item: { grade: any; _count: any; }) => ({
                    grade: item.grade,
                    count: item._count
                }))
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get inventory chart data');
        }
    }

    // Get employee performance data
    async getEmployeePerformance(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { storeId, period = 'month' } = req.query;

            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);

            // Build where clause for sales
            let salesWhere: any = {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            };

            if (user.role !== 'ADMIN') {
                salesWhere.storeId = user.storeId;
            } else if (storeId) {
                salesWhere.storeId = storeId as string;
            }

            // Get employee sales data
            const employeeSales = await prisma.sale.groupBy({
                by: ['employeeId'],
                where: salesWhere,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });

            // Get employee details
            const employees = await prisma.employee.findMany({
                where: user.role !== 'ADMIN' ? { storeId: user.storeId } : storeId ? { storeId: storeId as string } : {},
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true
                        }
                    }
                }
            });

            // Combine data
            const performanceData = employees.map((employee: { id: any; user: { firstName: any; lastName: any; email: any; role: any; }; position: any; }) => {
                const salesData = employeeSales.find((s: { employeeId: any; }) => s.employeeId === employee.id);
                return {
                    employeeId: employee.id,
                    name: `${employee.user.firstName} ${employee.user.lastName}`,
                    email: employee.user.email,
                    role: employee.user.role,
                    position: employee.position,
                    totalSales: salesData?._count || 0,
                    totalRevenue: salesData?._sum.total || 0,
                    averageSale: salesData?._avg.total || 0
                };
            });

            // Sort by total revenue
            performanceData.sort((a: { totalRevenue: number; }, b: { totalRevenue: number; }) => b.totalRevenue - a.totalRevenue);

            res.json({
                period: { start: startDate, end: endDate },
                employees: performanceData
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get employee performance data');
        }
    }

    // Private helper methods for chart data
    private async getDailySalesChartData(user: any, storeId: string, startDate: Date, endDate: Date) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);

        const result = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${startDate} 
        AND created_at <= ${endDate}
        ${whereClause}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

        return result;
    }

    private async getWeeklySalesChartData(user: any, storeId: string, startDate: Date, endDate: Date) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);

        const result = await prisma.$queryRaw`
      SELECT 
        YEAR(created_at) as year,
        WEEK(created_at) as week,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${startDate} 
        AND created_at <= ${endDate}
        ${whereClause}
      GROUP BY YEAR(created_at), WEEK(created_at)
      ORDER BY year, week
    `;

        return result;
    }

    private async getMonthlySalesChartData(user: any, storeId: string, startDate: Date, endDate: Date) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);

        const result = await prisma.$queryRaw`
      SELECT 
        YEAR(created_at) as year,
        MONTH(created_at) as month,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${startDate} 
        AND created_at <= ${endDate}
        ${whereClause}
      GROUP BY YEAR(created_at), MONTH(created_at)
      ORDER BY year, month
    `;

        return result;
    }

    private async getProductCategoryData(user: any, storeId: string) {
        const whereClause = this.getStoreFilter(user.role, user.storeId, storeId);

        const [byType, byGrade, tireByCategory, baleByCategory] = await Promise.all([
            prisma.product.groupBy({
                by: ['type'],
                where: whereClause,
                _count: true
            }),
            prisma.product.groupBy({
                by: ['grade'],
                where: whereClause,
                _count: true
            }),
            prisma.product.groupBy({
                by: ['tireCategory'],
                where: { ...whereClause, type: 'TIRE' },
                _count: true
            }),
            prisma.product.groupBy({
                by: ['baleCategory'],
                where: { ...whereClause, type: 'BALE' },
                _count: true
            })
        ]);

        return {
            byType: byType.map((item: { type: any; _count: any; }) => ({ type: item.type, count: item._count })),
            byGrade: byGrade.map((item: { grade: any; _count: any; }) => ({ grade: item.grade, count: item._count })),
            tireCategories: tireByCategory.map((item: { tireCategory: any; _count: any; }) => ({ category: item.tireCategory, count: item._count })),
            baleCategories: baleByCategory.map((item: { baleCategory: any; _count: any; }) => ({ category: item.baleCategory, count: item._count }))
        };
    }

    private buildSalesWhereClause(user: any, storeId: string, startDate: Date, endDate: Date) {
        if (user.role !== 'ADMIN') {
            return prisma.sql`AND store_id = ${user.storeId}`;
        } else if (storeId) {
            return prisma.sql`AND store_id = ${storeId}`;
        }
        return prisma.sql``;
    }
}