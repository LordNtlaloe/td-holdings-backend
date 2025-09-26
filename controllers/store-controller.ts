import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

interface StoreRequest extends Request {
    body: {
        name: string;
        location: string;
    };
}

// CREATE STORE
export const createStore = async (req: StoreRequest, res: Response) => {
    try {
        const { name, location } = req.body;

        if (!name || !location) {
            return res.status(400).json({ error: "Name and location are required" });
        }

        // Check if store with same name and location already exists
        const existingStore = await prisma.store.findFirst({
            where: { name, location },
        });

        if (existingStore) {
            return res.status(400).json({ error: "Store already exists at this location" });
        }

        const store = await prisma.store.create({
            data: { name, location },
        });

        res.status(201).json({
            message: "Store created successfully",
            store,
        });
    } catch (error) {
        console.error("Store creation error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET ALL STORES
export const getStores = async (req: Request, res: Response) => {
    try {
        const { location } = req.query;

        const where: any = {};
        if (location) where.location = { contains: location as string };

        const stores = await prisma.store.findMany({
            where,
            include: {
                _count: {
                    select: {
                        employees: true,
                        products: true,
                        sales: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json({ stores });
    } catch (error) {
        console.error("Get stores error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET STORE BY ID
export const getStoreById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const store = await prisma.store.findUnique({
            where: { id },
            include: {
                employees: {
                    include: {
                        user: { select: { email: true, role: true } },
                        _count: { select: { sales: true } },
                    },
                },
                products: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                        quantity: true,
                        price: true,
                        grade: true,
                    },
                },
                sales: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    select: {
                        id: true,
                        total: true,
                        createdAt: true,
                        employee: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        employees: true,
                        products: true,
                        sales: true,
                    },
                },
            },
        });

        if (!store) return res.status(404).json({ error: "Store not found" });

        res.json({ store });
    } catch (error) {
        console.error("Get store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// UPDATE STORE
export const updateStore = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, location } = req.body;

        if (!name && !location) {
            return res.status(400).json({ error: "At least one field is required" });
        }

        const store = await prisma.store.findUnique({ where: { id } });
        if (!store) return res.status(404).json({ error: "Store not found" });

        // Check if another store with same name and location exists
        if (name && location) {
            const existingStore = await prisma.store.findFirst({
                where: {
                    name,
                    location,
                    id: { not: id },
                },
            });

            if (existingStore) {
                return res.status(400).json({ error: "Another store already exists with this name and location" });
            }
        }

        const updatedStore = await prisma.store.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(location && { location }),
            },
        });

        res.json({
            message: "Store updated successfully",
            store: updatedStore,
        });
    } catch (error) {
        console.error("Update store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// DELETE STORE
export const deleteStore = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const store = await prisma.store.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        employees: true,
                        products: true,
                        sales: true,
                    },
                },
            },
        });

        if (!store) return res.status(404).json({ error: "Store not found" });

        // Check if store has associated data
        const { employees, products, sales } = store._count;
        if (employees > 0 || products > 0 || sales > 0) {
            return res.status(400).json({
                error: "Cannot delete store with existing employees, products, or sales",
                counts: { employees, products, sales },
            });
        }

        await prisma.store.delete({ where: { id } });

        res.json({ message: "Store deleted successfully" });
    } catch (error) {
        console.error("Delete store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET STORE ANALYTICS
export const getStoreAnalytics = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.query;

        const store = await prisma.store.findUnique({ where: { id } });
        if (!store) return res.status(404).json({ error: "Store not found" });

        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter.createdAt = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string),
            };
        }

        const [
            totalRevenue,
            salesCount,
            productCount,
            employeeCount,
            topSellingProducts,
            employeePerformance,
            dailySales
        ] = await Promise.all([
            // Total revenue
            prisma.sale.aggregate({
                where: { storeId: id, ...dateFilter },
                _sum: { total: true },
            }),
            // Sales count
            prisma.sale.count({
                where: { storeId: id, ...dateFilter },
            }),
            // Product count
            prisma.product.count({
                where: { storeId: id },
            }),
            // Employee count
            prisma.employee.count({
                where: { storeId: id },
            }),
            // Top selling products
            prisma.saleItem.groupBy({
                by: ["productId"],
                where: {
                    sale: { storeId: id, ...dateFilter },
                },
                _sum: { quantity: true },
                _avg: { price: true },
                orderBy: { _sum: { quantity: "desc" } },
                take: 5,
            }),
            // Employee performance
            prisma.sale.groupBy({
                by: ["employeeId"],
                where: { storeId: id, ...dateFilter },
                _sum: { total: true },
                _count: true,
                orderBy: { _sum: { total: "desc" } },
            }),
            // Daily sales for chart
            prisma.$queryRaw`
                SELECT 
                    DATE("createdAt") as date,
                    COUNT(*) as sales_count,
                    SUM(total) as revenue
                FROM "Sale" 
                WHERE "storeId" = ${id}
                ${startDate && endDate ? `AND "createdAt" BETWEEN ${startDate} AND ${endDate}` : ''}
                GROUP BY DATE("createdAt")
                ORDER BY date DESC
                LIMIT 30
            `
        ]);

        // Get product details for top selling products
        const productIds = topSellingProducts.map(item => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, type: true, price: true },
        });

        // Get employee details for performance
        const employeeIds = employeePerformance.map(item => item.employeeId);
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, firstName: true, lastName: true },
        });

        const analytics = {
            overview: {
                totalRevenue: totalRevenue._sum.total || 0,
                salesCount,
                productCount,
                employeeCount,
            },
            topSellingProducts: topSellingProducts.map(item => {
                const product = products.find(p => p.id === item.productId);
                return {
                    product,
                    quantitySold: item._sum.quantity,
                    averagePrice: item._avg.price,
                };
            }),
            employeePerformance: employeePerformance.map(item => {
                const employee = employees.find(e => e.id === item.employeeId);
                return {
                    employee,
                    totalRevenue: item._sum.total,
                    salesCount: item._count,
                };
            }),
            dailySales,
        };

        res.json({ analytics });
    } catch (error) {
        console.error("Get store analytics error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET STORES SUMMARY (for admin dashboard)
export const getStoresSummary = async (req: Request, res: Response) => {
    try {
        const stores = await prisma.store.findMany({
            select: {
                id: true,
                name: true,
                location: true,
                _count: {
                    select: {
                        employees: true,
                        products: true,
                        sales: true,
                    },
                },
            },
        });

        // Get revenue for each store
        const storesWithRevenue = await Promise.all(
            stores.map(async (store) => {
                const revenue = await prisma.sale.aggregate({
                    where: { storeId: store.id },
                    _sum: { total: true },
                });

                return {
                    ...store,
                    totalRevenue: revenue._sum.total || 0,
                };
            })
        );

        const summary = {
            totalStores: stores.length,
            totalEmployees: stores.reduce((sum, store) => sum + store._count.employees, 0),
            totalProducts: stores.reduce((sum, store) => sum + store._count.products, 0),
            totalSales: stores.reduce((sum, store) => sum + store._count.sales, 0),
            totalRevenue: storesWithRevenue.reduce((sum, store) => sum + store.totalRevenue, 0),
            stores: storesWithRevenue,
        };

        res.json({ summary });
    } catch (error) {
        console.error("Get stores summary error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};