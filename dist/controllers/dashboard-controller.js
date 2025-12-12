"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
class DashboardController extends base_controller_1.BaseController {
    async getDashboardData(req, res) {
        try {
            const user = req.user;
            const { storeId, period = 'month' } = req.query;
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
            let where = {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            };
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }
            else if (storeId) {
                where.storeId = storeId;
            }
            const [salesSummary, productStats, employeeStats, recentActivities, dailySalesData, productCategoryData, topProducts] = await Promise.all([
                prisma_1.prisma.sale.aggregate({
                    where,
                    _sum: { total: true },
                    _count: true,
                    _avg: { total: true }
                }),
                prisma_1.prisma.product.aggregate({
                    where: this.getStoreFilter(user.role, user.storeId, storeId),
                    _sum: { quantity: true },
                    _count: true,
                    _avg: { price: true }
                }),
                prisma_1.prisma.employee.aggregate({
                    where: { storeId: user.role !== 'ADMIN' ? user.storeId : storeId || undefined },
                    _count: true
                }),
                prisma_1.prisma.activityLog.findMany({
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
                this.getDailySalesChartData(user, storeId, startDate, endDate),
                this.getProductCategoryData(user, storeId),
                prisma_1.prisma.saleItem.groupBy({
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
            const topProductsWithDetails = await Promise.all(topProducts.map(async (item) => {
                const product = await prisma_1.prisma.product.findUnique({
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
            }));
            const lowStockProducts = await prisma_1.prisma.product.findMany({
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId),
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get dashboard data');
        }
    }
    async getSalesChartData(req, res) {
        try {
            const user = req.user;
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
                salesData = await this.getDailySalesChartData(user, storeId, startDate, endDate);
            }
            else if (groupBy === 'week') {
                salesData = await this.getWeeklySalesChartData(user, storeId, startDate, endDate);
            }
            else if (groupBy === 'month') {
                salesData = await this.getMonthlySalesChartData(user, storeId, startDate, endDate);
            }
            res.json({
                period,
                groupBy,
                data: salesData,
                dateRange: { start: startDate, end: endDate }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get sales chart data');
        }
    }
    async getInventoryChartData(req, res) {
        try {
            const user = req.user;
            const { storeId } = req.query;
            const productsByType = await prisma_1.prisma.product.groupBy({
                by: ['type'],
                where: this.getStoreFilter(user.role, user.storeId, storeId),
                _count: true,
                _sum: { quantity: true }
            });
            const tireCategories = await prisma_1.prisma.product.groupBy({
                by: ['tireCategory'],
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId),
                    type: 'TIRE',
                    tireCategory: { not: null }
                },
                _count: true
            });
            const baleCategories = await prisma_1.prisma.product.groupBy({
                by: ['baleCategory'],
                where: {
                    ...this.getStoreFilter(user.role, user.storeId, storeId),
                    type: 'BALE',
                    baleCategory: { not: null }
                },
                _count: true
            });
            const productsByGrade = await prisma_1.prisma.product.groupBy({
                by: ['grade'],
                where: this.getStoreFilter(user.role, user.storeId, storeId),
                _count: true
            });
            res.json({
                byType: productsByType.map(item => ({
                    type: item.type,
                    count: item._count,
                    totalQuantity: item._sum.quantity
                })),
                tireCategories: tireCategories.map(item => ({
                    category: item.tireCategory,
                    count: item._count
                })),
                baleCategories: baleCategories.map(item => ({
                    category: item.baleCategory,
                    count: item._count
                })),
                byGrade: productsByGrade.map(item => ({
                    grade: item.grade,
                    count: item._count
                }))
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get inventory chart data');
        }
    }
    async getEmployeePerformance(req, res) {
        try {
            const user = req.user;
            const { storeId, period = 'month' } = req.query;
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
            let salesWhere = {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            };
            if (user.role !== 'ADMIN') {
                salesWhere.storeId = user.storeId;
            }
            else if (storeId) {
                salesWhere.storeId = storeId;
            }
            const employeeSales = await prisma_1.prisma.sale.groupBy({
                by: ['employeeId'],
                where: salesWhere,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
            const employees = await prisma_1.prisma.employee.findMany({
                where: user.role !== 'ADMIN' ? { storeId: user.storeId } : storeId ? { storeId: storeId } : {},
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
            const performanceData = employees.map(employee => {
                const salesData = employeeSales.find(s => s.employeeId === employee.id);
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
            performanceData.sort((a, b) => b.totalRevenue - a.totalRevenue);
            res.json({
                period: { start: startDate, end: endDate },
                employees: performanceData
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employee performance data');
        }
    }
    async getDailySalesChartData(user, storeId, startDate, endDate) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);
        const result = await prisma_1.prisma.$queryRaw `
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
    async getWeeklySalesChartData(user, storeId, startDate, endDate) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);
        const result = await prisma_1.prisma.$queryRaw `
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
    async getMonthlySalesChartData(user, storeId, startDate, endDate) {
        const whereClause = this.buildSalesWhereClause(user, storeId, startDate, endDate);
        const result = await prisma_1.prisma.$queryRaw `
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
    async getProductCategoryData(user, storeId) {
        const whereClause = this.getStoreFilter(user.role, user.storeId, storeId);
        const [byType, byGrade, tireByCategory, baleByCategory] = await Promise.all([
            prisma_1.prisma.product.groupBy({
                by: ['type'],
                where: whereClause,
                _count: true
            }),
            prisma_1.prisma.product.groupBy({
                by: ['grade'],
                where: whereClause,
                _count: true
            }),
            prisma_1.prisma.product.groupBy({
                by: ['tireCategory'],
                where: { ...whereClause, type: 'TIRE' },
                _count: true
            }),
            prisma_1.prisma.product.groupBy({
                by: ['baleCategory'],
                where: { ...whereClause, type: 'BALE' },
                _count: true
            })
        ]);
        return {
            byType: byType.map(item => ({ type: item.type, count: item._count })),
            byGrade: byGrade.map(item => ({ grade: item.grade, count: item._count })),
            tireCategories: tireByCategory.map(item => ({ category: item.tireCategory, count: item._count })),
            baleCategories: baleByCategory.map(item => ({ category: item.baleCategory, count: item._count }))
        };
    }
    buildSalesWhereClause(user, storeId, startDate, endDate) {
        if (user.role !== 'ADMIN') {
            return prisma_1.prisma.sql `AND store_id = ${user.storeId}`;
        }
        else if (storeId) {
            return prisma_1.prisma.sql `AND store_id = ${storeId}`;
        }
        return prisma_1.prisma.sql ``;
    }
}
exports.DashboardController = DashboardController;
//# sourceMappingURL=dashboard-controller.js.map