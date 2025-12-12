"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaleController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
class SaleController extends base_controller_1.BaseController {
    async createSale(req, res) {
        try {
            const user = req.user;
            const { items, customerInfo } = req.body;
            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Sale items are required' });
            }
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { userId: user.id }
            });
            if (!employee) {
                return res.status(400).json({ error: 'Employee record not found' });
            }
            const result = await prisma_1.prisma.$transaction(async (tx) => {
                let total = 0;
                const saleItems = [];
                for (const item of items) {
                    const product = await tx.product.findUnique({
                        where: {
                            id_storeId: {
                                id: item.productId,
                                storeId: employee.storeId
                            }
                        }
                    });
                    if (!product) {
                        throw new Error(`Product ${item.productId} not found in store`);
                    }
                    if (product.quantity < item.quantity) {
                        throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.quantity}`);
                    }
                    const itemTotal = product.price * item.quantity;
                    total += itemTotal;
                    saleItems.push({
                        productId: product.id,
                        quantity: item.quantity,
                        price: product.price
                    });
                    await tx.product.update({
                        where: {
                            id_storeId: {
                                id: product.id,
                                storeId: employee.storeId
                            }
                        },
                        data: {
                            quantity: product.quantity - item.quantity
                        }
                    });
                }
                const sale = await tx.sale.create({
                    data: {
                        employeeId: employee.id,
                        storeId: employee.storeId,
                        total,
                        saleItems: {
                            create: saleItems
                        }
                    },
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
                        },
                        store: {
                            select: {
                                name: true,
                                location: true
                            }
                        }
                    }
                });
                await tx.activityLog.create({
                    data: {
                        userId: user.id,
                        action: 'CREATE_SALE',
                        entityType: 'SALE',
                        entityId: sale.id,
                        details: {
                            saleId: sale.id,
                            total: sale.total,
                            itemsCount: sale.saleItems.length,
                            employee: `${employee.firstName} ${employee.lastName}`
                        }
                    }
                });
                return sale;
            });
            res.status(201).json({
                message: 'Sale created successfully',
                sale: result
            });
        }
        catch (error) {
            this.handleError(res, error, error.message || 'Failed to create sale');
        }
    }
    async getSales(req, res) {
        try {
            const user = req.user;
            const { storeId, employeeId, startDate, endDate, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            let where = {};
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }
            else if (storeId) {
                where.storeId = storeId;
            }
            if (employeeId) {
                where.employeeId = employeeId;
            }
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate);
                }
            }
            const [sales, total] = await Promise.all([
                prisma_1.prisma.sale.findMany({
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
                            include: {
                                product: true
                            }
                        }
                    },
                    orderBy: { [sortBy]: sortOrder },
                    skip,
                    take: limitNum
                }),
                prisma_1.prisma.sale.count({ where })
            ]);
            res.json({
                sales,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get sales');
        }
    }
    async getSaleById(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const sale = await prisma_1.prisma.sale.findUnique({
                where: { id },
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
                    store: true,
                    saleItems: {
                        include: {
                            product: true
                        }
                    }
                }
            });
            if (!sale) {
                return res.status(404).json({ error: 'Sale not found' });
            }
            if (user.role !== 'ADMIN' && user.storeId !== sale.storeId) {
                return res.status(403).json({ error: 'Access denied to this sale' });
            }
            res.json(sale);
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get sale');
        }
    }
    async getSalesSummary(req, res) {
        try {
            const user = req.user;
            const { period = 'today', storeId } = req.query;
            let dateFilter = {};
            const now = new Date();
            switch (period) {
                case 'today':
                    dateFilter.gte = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'week':
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    dateFilter.gte = weekAgo;
                    break;
                case 'month':
                    const monthAgo = new Date();
                    monthAgo.setMonth(monthAgo.getMonth() - 1);
                    dateFilter.gte = monthAgo;
                    break;
                case 'year':
                    const yearAgo = new Date();
                    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
                    dateFilter.gte = yearAgo;
                    break;
            }
            let where = { createdAt: dateFilter };
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }
            else if (storeId) {
                where.storeId = storeId;
            }
            const [totalSales, salesCount, recentSales, topProducts] = await Promise.all([
                prisma_1.prisma.sale.aggregate({
                    where,
                    _sum: { total: true }
                }),
                prisma_1.prisma.sale.count({ where }),
                prisma_1.prisma.sale.findMany({
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
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5
                }),
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
                    take: 5
                })
            ]);
            const topProductsWithDetails = await Promise.all(topProducts.map(async (item) => {
                const product = await prisma_1.prisma.product.findUnique({
                    where: { id: item.productId },
                    select: {
                        name: true,
                        type: true
                    }
                });
                return {
                    productId: item.productId,
                    productName: product?.name,
                    productType: product?.type,
                    totalQuantity: item._sum.quantity,
                    totalRevenue: item._sum.price
                };
            }));
            res.json({
                summary: {
                    totalRevenue: totalSales._sum.total || 0,
                    totalSales: salesCount,
                    averageSale: salesCount > 0 ? (totalSales._sum.total || 0) / salesCount : 0
                },
                recentSales,
                topProducts: topProductsWithDetails
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get sales summary');
        }
    }
    async getDailySalesReport(req, res) {
        try {
            const user = req.user;
            const { startDate, endDate, storeId } = req.query;
            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate ? new Date(startDate) : new Date();
            start.setDate(start.getDate() - 30);
            let where = {
                createdAt: {
                    gte: start,
                    lte: end
                }
            };
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }
            else if (storeId) {
                where.storeId = storeId;
            }
            const dailySales = await prisma_1.prisma.$queryRaw `
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as sales_count,
          SUM(total) as total_revenue,
          AVG(total) as average_sale
        FROM sales
        WHERE created_at >= ${start} 
          AND created_at <= ${end}
          ${user.role !== 'ADMIN' ? prisma_1.prisma.sql `AND store_id = ${user.storeId}` : storeId ? prisma_1.prisma.sql `AND store_id = ${storeId}` : prisma_1.prisma.sql ``}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const salesByHour = await prisma_1.prisma.$queryRaw `
        SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as sales_count,
          SUM(total) as total_revenue
        FROM sales
        WHERE created_at >= ${todayStart}
          ${user.role !== 'ADMIN' ? prisma_1.prisma.sql `AND store_id = ${user.storeId}` : storeId ? prisma_1.prisma.sql `AND store_id = ${storeId}` : prisma_1.prisma.sql ``}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour
      `;
            res.json({
                dailySales,
                salesByHour,
                dateRange: { start, end }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get daily sales report');
        }
    }
    async voidSale(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { reason } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            const sale = await prisma_1.prisma.sale.findUnique({
                where: { id },
                include: {
                    saleItems: true,
                    store: true
                }
            });
            if (!sale) {
                return res.status(404).json({ error: 'Sale not found' });
            }
            if (user.role === 'MANAGER' && user.storeId !== sale.storeId) {
                return res.status(403).json({ error: 'Access denied to this sale' });
            }
            const saleAge = Date.now() - sale.createdAt.getTime();
            const maxVoidAge = 24 * 60 * 60 * 1000;
            if (saleAge > maxVoidAge && user.role !== 'ADMIN') {
                return res.status(400).json({
                    error: 'Sales can only be voided within 24 hours. Contact admin.'
                });
            }
            const result = await prisma_1.prisma.$transaction(async (tx) => {
                for (const item of sale.saleItems) {
                    await tx.product.update({
                        where: {
                            id_storeId: {
                                id: item.productId,
                                storeId: sale.storeId
                            }
                        },
                        data: {
                            quantity: {
                                increment: item.quantity
                            }
                        }
                    });
                }
                const voidRecord = await tx.voidedSale.create({
                    data: {
                        saleId: sale.id,
                        voidedBy: user.id,
                        reason,
                        originalTotal: sale.total
                    }
                });
                await tx.sale.delete({
                    where: { id }
                });
                await tx.activityLog.create({
                    data: {
                        userId: user.id,
                        action: 'VOID_SALE',
                        entityType: 'SALE',
                        entityId: sale.id,
                        details: {
                            saleId: sale.id,
                            originalTotal: sale.total,
                            reason,
                            voidedBy: user.email
                        }
                    }
                });
                return { voidRecord, sale };
            });
            res.json({
                message: 'Sale voided successfully',
                ...result
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to void sale');
        }
    }
}
exports.SaleController = SaleController;
//# sourceMappingURL=sales-controller.js.map