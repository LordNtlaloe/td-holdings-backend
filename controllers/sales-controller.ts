// controllers/sale.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';

export class SaleController extends BaseController {
    // Create sale
    async createSale(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { items, customerInfo } = req.body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Sale items are required' });
            }

            // Get employee
            const employee = await prisma.employee.findUnique({
                where: { userId: user.id }
            });

            if (!employee) {
                return res.status(400).json({ error: 'Employee record not found' });
            }

            const result = await prisma.$transaction(async (tx) => {
                let total = 0;
                const saleItems = [];

                // Process each sale item
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

                    // Add to sale items array
                    saleItems.push({
                        productId: product.id,
                        quantity: item.quantity,
                        price: product.price
                    });

                    // Update product quantity
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

                // Create sale
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

                // Create activity log
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
        } catch (error: any) {
            this.handleError(res, error, error.message || 'Failed to create sale');
        }
    }

    // Get all sales (with filtering)
    async getSales(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                storeId,
                employeeId,
                startDate,
                endDate,
                page = 1,
                limit = 20,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            // Build where clause
            let where: any = {};

            // Store filter
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            } else if (storeId) {
                where.storeId = storeId as string;
            }

            if (employeeId) {
                where.employeeId = employeeId as string;
            }

            // Date filter
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate as string);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate as string);
                }
            }

            // Get sales with pagination
            const [sales, total] = await Promise.all([
                prisma.sale.findMany({
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
                    orderBy: { [sortBy as string]: sortOrder },
                    skip,
                    take: limitNum
                }),
                prisma.sale.count({ where })
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get sales');
        }
    }

    // Get sale by ID
    async getSaleById(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            const sale = await prisma.sale.findUnique({
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

            // Check access
            if (user.role !== 'ADMIN' && user.storeId !== sale.storeId) {
                return res.status(403).json({ error: 'Access denied to this sale' });
            }

            res.json(sale);
        } catch (error) {
            this.handleError(res, error, 'Failed to get sale');
        }
    }

    // Get sales summary (for dashboard)
    async getSalesSummary(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { period = 'today', storeId } = req.query;

            let dateFilter: any = {};
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

            // Build where clause
            let where: any = { createdAt: dateFilter };

            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            } else if (storeId) {
                where.storeId = storeId as string;
            }

            // Get sales data
            const [totalSales, salesCount, recentSales, topProducts] = await Promise.all([
                // Total sales amount
                prisma.sale.aggregate({
                    where,
                    _sum: { total: true }
                }),

                // Number of sales
                prisma.sale.count({ where }),

                // Recent sales (last 5)
                prisma.sale.findMany({
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
                    take: 5
                })
            ]);

            // Get product details for top products
            const topProductsWithDetails = await Promise.all(
                topProducts.map(async (item) => {
                    const product = await prisma.product.findUnique({
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
                })
            );

            res.json({
                summary: {
                    totalRevenue: totalSales._sum.total || 0,
                    totalSales: salesCount,
                    averageSale: salesCount > 0 ? (totalSales._sum.total || 0) / salesCount : 0
                },
                recentSales,
                topProducts: topProductsWithDetails
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get sales summary');
        }
    }

    // Get daily sales report
    // Alternative approach using Prisma's findMany with grouping
    async getDailySalesReport(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { startDate, endDate, storeId } = req.query;

            // Set date range
            const end = endDate ? new Date(endDate as string) : new Date();
            const start = startDate ? new Date(startDate as string) : new Date();
            start.setDate(start.getDate() - 30);

            // Build where clause
            let where: any = {
                createdAt: {
                    gte: start,
                    lte: end
                }
            };

            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            } else if (storeId) {
                where.storeId = storeId as string;
            }

            // Get sales grouped by day using Prisma's aggregation
            const salesByDate = await prisma.sale.groupBy({
                by: ['createdAt'],
                where,
                _count: {
                    id: true
                },
                _sum: {
                    total: true
                }
            });

            // Format the data
            const dailySales = salesByDate.map(item => {
                const date = new Date(item.createdAt);
                date.setHours(0, 0, 0, 0); // Normalize to start of day

                return {
                    date,
                    sales_count: item._count.id,
                    total_revenue: item._sum.total || 0,
                    average_sale: item._count.id > 0 ? (item._sum.total || 0) / item._count.id : 0
                };
            });

            // Group by unique dates
            const groupedDailySales = dailySales.reduce((acc, curr) => {
                const dateKey = curr.date.toISOString().split('T')[0];

                if (!acc[dateKey]) {
                    acc[dateKey] = {
                        date: curr.date,
                        sales_count: 0,
                        total_revenue: 0,
                        average_sale: 0
                    };
                }

                acc[dateKey].sales_count += curr.sales_count;
                acc[dateKey].total_revenue += curr.total_revenue;

                return acc;
            }, {} as Record<string, any>);

            // Calculate average for each day and convert to array
            const result = Object.values(groupedDailySales).map((item: any) => ({
                ...item,
                average_sale: item.sales_count > 0 ? item.total_revenue / item.sales_count : 0
            })).sort((a: any, b: any) => b.date.getTime() - a.date.getTime());

            res.json({
                dailySales: result,
                dateRange: { start, end }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get daily sales report');
        }
    }

    // Void sale (Admin/Manager only)
    async voidSale(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;
            const { reason } = req.body;

            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const sale = await prisma.sale.findUnique({
                where: { id },
                include: {
                    saleItems: true,
                    store: true
                }
            });

            if (!sale) {
                return res.status(404).json({ error: 'Sale not found' });
            }

            // Check access
            if (user.role === 'MANAGER' && user.storeId !== sale.storeId) {
                return res.status(403).json({ error: 'Access denied to this sale' });
            }

            // Check if sale is recent (within 24 hours)
            const saleAge = Date.now() - sale.createdAt.getTime();
            const maxVoidAge = 24 * 60 * 60 * 1000; // 24 hours

            if (saleAge > maxVoidAge && user.role !== 'ADMIN') {
                return res.status(400).json({
                    error: 'Sales can only be voided within 24 hours. Contact admin.'
                });
            }

            const result = await prisma.$transaction(async (tx) => {
                // Restore product quantities
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

                // Create void record
                const voidRecord = await tx.voidedSale.create({
                    data: {
                        saleId: sale.id,
                        voidedBy: user.id,
                        reason,
                        originalTotal: sale.total
                    }
                });

                // Delete sale (or mark as voided if you want to keep record)
                await tx.sale.delete({
                    where: { id }
                });

                // Create activity log
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
        } catch (error) {
            this.handleError(res, error, 'Failed to void sale');
        }
    }
}