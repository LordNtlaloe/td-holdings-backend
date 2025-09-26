import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

interface SaleRequest extends Request {
    body: {
        employeeId: string;
        storeId: string;
        items: Array<{
            productId: string;
            quantity: number;
            price: number;
        }>;
    };
}

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        role: string;
    };
}

// CREATE SALE (POS Transaction)
export const createSale = async (req: SaleRequest, res: Response) => {
    try {
        const { employeeId, storeId, items } = req.body;

        // Validation
        if (!employeeId || !storeId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "Employee ID, Store ID, and items are required" });
        }

        // Validate items
        for (const item of items) {
            if (!item.productId || !item.quantity || item.quantity <= 0 || !item.price || item.price <= 0) {
                return res.status(400).json({ error: "Each item must have productId, quantity > 0, and price > 0" });
            }
        }

        // Verify employee exists and belongs to the store
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { store: true },
        });

        if (!employee) return res.status(400).json({ error: "Employee not found" });
        if (employee.storeId !== storeId) return res.status(400).json({ error: "Employee does not belong to this store" });

        // Verify products exist, belong to the store, and have sufficient stock
        const productIds = items.map(item => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds }, storeId },
        });

        if (products.length !== productIds.length) {
            return res.status(400).json({ error: "One or more products not found in this store" });
        }

        // Check stock availability
        const stockIssues = [];
        for (const item of items) {
            const product = products.find(p => p.id === item.productId);
            if (!product) continue;

            if (product.quantity < item.quantity) {
                stockIssues.push({
                    productId: item.productId,
                    productName: product.name,
                    available: product.quantity,
                    requested: item.quantity,
                });
            }
        }

        if (stockIssues.length > 0) {
            return res.status(400).json({
                error: "Insufficient stock for some items",
                stockIssues
            });
        }

        // Calculate total
        const total = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);

        // Create sale and update product quantities in a transaction
        const sale = await prisma.$transaction(async (tx) => {
            // Create sale
            const newSale = await tx.sale.create({
                data: {
                    employeeId,
                    storeId,
                    total,
                },
            });

            // Create sale items and update product quantities
            for (const item of items) {
                await tx.saleItem.create({
                    data: {
                        saleId: newSale.id,
                        productId: item.productId,
                        quantity: item.quantity,
                        price: item.price,
                    },
                });

                // Update product quantity
                await tx.product.update({
                    where: { id: item.productId },
                    data: { quantity: { decrement: item.quantity } },
                });
            }

            return newSale;
        });

        // Fetch complete sale data
        const completeSale = await prisma.sale.findUnique({
            where: { id: sale.id },
            include: {
                employee: {
                    select: { firstName: true, lastName: true, id: true },
                },
                store: {
                    select: { name: true, location: true, id: true },
                },
                saleItems: {
                    include: {
                        product: {
                            select: { name: true, type: true, id: true },
                        },
                    },
                },
            },
        });

        res.status(201).json({
            message: "Sale completed successfully",
            sale: completeSale,
        });
    } catch (error) {
        console.error("Sale creation error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET ALL SALES
export const getSales = async (req: Request, res: Response) => {
    try {
        const {
            storeId, employeeId, startDate, endDate,
            minTotal, maxTotal, page = 1, limit = 20
        } = req.query;

        const where: any = {};

        if (storeId) where.storeId = storeId as string;
        if (employeeId) where.employeeId = employeeId as string;

        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string),
            };
        }

        if (minTotal || maxTotal) {
            where.total = {};
            if (minTotal) where.total.gte = parseFloat(minTotal as string);
            if (maxTotal) where.total.lte = parseFloat(maxTotal as string);
        }

        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const take = parseInt(limit as string);

        const [sales, totalCount] = await Promise.all([
            prisma.sale.findMany({
                where,
                include: {
                    employee: {
                        select: { firstName: true, lastName: true, id: true },
                    },
                    store: {
                        select: { name: true, location: true, id: true },
                    },
                    saleItems: {
                        include: {
                            product: {
                                select: { name: true, type: true, id: true },
                            },
                        },
                    },
                    _count: { select: { saleItems: true } },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.sale.count({ where }),
        ]);

        const totalPages = Math.ceil(totalCount / take);

        res.json({
            sales,
            pagination: {
                page: parseInt(page as string),
                limit: take,
                totalCount,
                totalPages,
                hasNext: parseInt(page as string) < totalPages,
                hasPrev: parseInt(page as string) > 1,
            },
        });
    } catch (error) {
        console.error("Get sales error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET SALE BY ID
export const getSaleById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const sale = await prisma.sale.findUnique({
            where: { id },
            include: {
                employee: {
                    select: { firstName: true, lastName: true, id: true, phone: true },
                },
                store: {
                    select: { name: true, location: true, id: true },
                },
                saleItems: {
                    include: {
                        product: {
                            select: {
                                name: true,
                                type: true,
                                id: true,
                                tireSize: true,
                                tireCategory: true,
                                tireUsage: true,
                            },
                        },
                    },
                },
            },
        });

        if (!sale) return res.status(404).json({ error: "Sale not found" });

        res.json({ sale });
    } catch (error) {
        console.error("Get sale error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET SALES ANALYTICS
export const getSalesAnalytics = async (req: Request, res: Response) => {
    try {
        const { storeId, employeeId, startDate, endDate } = req.query;

        const where: any = {};
        if (storeId) where.storeId = storeId as string;
        if (employeeId) where.employeeId = employeeId as string;

        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string),
            };
        }

        const [
            totalSales,
            totalRevenue,
            averageSaleValue,
            salesByDay,
            topEmployees,
            productTypeBreakdown,
            recentSales
        ] = await Promise.all([
            // Total sales count
            prisma.sale.count({ where }),

            // Total revenue
            prisma.sale.aggregate({
                where,
                _sum: { total: true },
            }),

            // Average sale value
            prisma.sale.aggregate({
                where,
                _avg: { total: true },
            }),

            // Sales by day (last 30 days)
            prisma.$queryRaw`
                SELECT 
                    DATE("createdAt") as date,
                    COUNT(*) as sales_count,
                    SUM(total) as revenue,
                    AVG(total) as avg_sale
                FROM "Sale" 
                WHERE 1=1
                ${storeId ? `AND "storeId" = ${storeId}` : ''}
                ${employeeId ? `AND "employeeId" = ${employeeId}` : ''}
                ${startDate && endDate ? `AND "createdAt" BETWEEN ${startDate} AND ${endDate}` : ''}
                GROUP BY DATE("createdAt")
                ORDER BY date DESC
                LIMIT 30
            `,

            // Top performing employees
            prisma.sale.groupBy({
                by: ["employeeId"],
                where: { ...where, ...(storeId && { storeId: storeId as string }) },
                _sum: { total: true },
                _count: true,
                _avg: { total: true },
                orderBy: { _sum: { total: "desc" } },
                take: 10,
            }),

            // Product type breakdown
            prisma.saleItem.groupBy({
                by: ["productId"],
                where: {
                    sale: where,
                },
                _sum: { quantity: true },
                _avg: { price: true },
                orderBy: { _sum: { quantity: "desc" } },
                take: 5,
            }),

            // Recent sales
            prisma.sale.findMany({
                where,
                include: {
                    employee: { select: { firstName: true, lastName: true } },
                    store: { select: { name: true } },
                    _count: { select: { saleItems: true } },
                },
                orderBy: { createdAt: "desc" },
                take: 5,
            }),
        ]);

        // Get employee details for top performers
        const employeeIds = topEmployees.map(emp => emp.employeeId);
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, firstName: true, lastName: true, store: { select: { name: true } } },
        });

        // Get product details for type breakdown
        const productIds = productTypeBreakdown.map(item => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, type: true },
        });

        const analytics = {
            overview: {
                totalSales,
                totalRevenue: totalRevenue._sum.total || 0,
                averageSaleValue: averageSaleValue._avg.total || 0,
            },
            trends: {
                salesByDay,
            },
            performance: {
                topEmployees: topEmployees.map(emp => {
                    const employee = employees.find(e => e.id === emp.employeeId);
                    const totalRevenue = emp._sum.total || 0;
                    const totalSales = emp._count || 0;
                    const averageSaleValue = emp._avg.total || 0;

                    return {
                        employee,
                        totalRevenue,
                        totalSales,
                        averageSaleValue,
                    };
                }),
                topProducts: productTypeBreakdown.map(item => {
                    const product = products.find(p => p.id === item.productId);
                    const quantitySold = item._sum.quantity || 0;
                    const averagePrice = item._avg.price || 0;

                    return {
                        product,
                        quantitySold,
                        averagePrice,
                    };
                }),
            },
            recentActivity: recentSales,
        };

        res.json({ analytics });
    } catch (error) {
        console.error("Get sales analytics error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// VOID/CANCEL SALE (Admin/Manager only)
export const voidSale = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Check authorization (this would typically be handled by middleware)
        const userRole = req.user?.role;
        if (!userRole || !['ADMIN', 'MANAGER'].includes(userRole)) {
            return res.status(403).json({ error: "Only admins and managers can void sales" });
        }

        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ error: "A detailed reason is required for voiding sales" });
        }

        const sale = await prisma.sale.findUnique({
            where: { id },
            include: {
                saleItems: {
                    include: { product: true },
                },
            },
        });

        if (!sale) return res.status(404).json({ error: "Sale not found" });

        // Check if sale is recent (within 24 hours for safety)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (sale.createdAt < twentyFourHoursAgo) {
            return res.status(400).json({ error: "Cannot void sales older than 24 hours" });
        }

        // Restore product quantities and mark sale as voided
        await prisma.$transaction(async (tx) => {
            // Restore product quantities
            for (const item of sale.saleItems) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { quantity: { increment: item.quantity } },
                });
            }

            // Here you could add a VoidedSale table to track voided sales
            // For now, we'll delete the sale and its items
            await tx.saleItem.deleteMany({
                where: { saleId: id },
            });

            await tx.sale.delete({
                where: { id },
            });
        });

        res.json({
            message: "Sale voided successfully",
            voidReason: reason,
        });
    } catch (error) {
        console.error("Void sale error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET DAILY SALES REPORT
export const getDailySalesReport = async (req: Request, res: Response) => {
    try {
        const { date, storeId } = req.query;

        const targetDate = date ? new Date(date as string) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const where: any = {
            createdAt: {
                gte: startOfDay,
                lte: endOfDay,
            },
        };

        if (storeId) where.storeId = storeId as string;

        const [
            sales,
            totalRevenue,
            totalSalesCount,
            employeePerformance,
            productSales
        ] = await Promise.all([
            // All sales for the day
            prisma.sale.findMany({
                where,
                include: {
                    employee: { select: { firstName: true, lastName: true } },
                    saleItems: {
                        include: {
                            product: { select: { name: true, type: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            }),

            // Total revenue
            prisma.sale.aggregate({
                where,
                _sum: { total: true },
            }),

            // Total sales count
            prisma.sale.count({ where }),

            // Employee performance for the day
            prisma.sale.groupBy({
                by: ["employeeId"],
                where,
                _sum: { total: true },
                _count: true,
            }),

            // Product sales for the day
            prisma.saleItem.groupBy({
                by: ["productId"],
                where: {
                    sale: where,
                },
                _sum: { quantity: true, price: true },
                _count: true,
            }),
        ]);

        // Get employee details
        const employeeIds = employeePerformance.map(emp => emp.employeeId);
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, firstName: true, lastName: true },
        });

        // Get product details
        const productIds = productSales.map(item => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, type: true },
        });

        const totalRevenueValue = totalRevenue._sum.total || 0;
        const totalSalesValue = totalSalesCount || 0;

        const report = {
            date: targetDate.toISOString().split('T')[0],
            summary: {
                totalRevenue: totalRevenueValue,
                totalSales: totalSalesValue,
                averageSaleValue: totalSalesValue > 0 ? totalRevenueValue / totalSalesValue : 0,
            },
            employeePerformance: employeePerformance.map(emp => {
                const employee = employees.find(e => e.id === emp.employeeId);
                const totalRevenue = emp._sum.total || 0;
                const totalSales = emp._count || 0;

                return {
                    employee,
                    totalRevenue,
                    totalSales,
                    averageSaleValue: totalSales > 0 ? totalRevenue / totalSales : 0,
                };
            }),
            productPerformance: productSales.map(item => {
                const product = products.find(p => p.id === item.productId);
                const totalPrice = item._sum.price || 0;
                const quantitySold = item._sum.quantity || 0;

                return {
                    product,
                    quantitySold,
                    revenue: totalPrice,
                    averagePrice: quantitySold > 0 ? totalPrice / quantitySold : 0,
                };
            }),
            sales,
        };

        res.json({ report });
    } catch (error) {
        console.error("Get daily sales report error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};