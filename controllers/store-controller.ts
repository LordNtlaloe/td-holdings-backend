// controllers/store-controller.ts
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta, calculateInventoryMetrics } from "../helpers";

// Define custom type for authenticated request
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
}

// Update the search fields to match your form
export const getStores = async (req: Request, res: Response): Promise<void> => {
    try {
        const { page = 1, limit = 10, sortBy, sortOrder, search, isMainStore, type, city } = req.query;
        const { skip, take } = generatePagination(Number(page), Number(limit));

        const filterBuilder = new FilterBuilder()
            .where(search as string, ['name', 'city', 'email', 'address', 'phone'])
            .status(isMainStore as string, 'isMainStore')
            .status(type as string, 'type')
            .status(city as string, 'city')
            .order(sortBy as string, sortOrder as 'asc' | 'desc');

        const filters = filterBuilder.build();

        const [stores, total] = await Promise.all([
            prisma.store.findMany({
                where: filters.where,
                skip,
                take,
                orderBy: filters.orderBy,
                include: {
                    _count: {
                        select: {
                            employees: true,
                            inventories: true,
                            users: true
                        }
                    }
                }
            }),
            prisma.store.count({ where: filters.where })
        ]);

        res.json({
            data: stores,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get stores error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getStoreById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;

        const store = await prisma.store.findUnique({
            where: { id: storeId },
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: true,
                        users: true,
                        sales: true
                    }
                },
                users: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        role: true
                    },
                    take: 5
                },
                employees: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    take: 5
                }
            }
        });

        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        res.json(store);
    } catch (error) {
        console.error("Get store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const createStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const {
            name,
            city,
            type,
            address,
            phone,
            email,
            isMainStore = false,
            latitude,
            longitude,
            weekdayHours = '8:00 AM - 6:00 PM',
            saturdayHours = '9:00 AM - 4:00 PM',
            sundayHours = '10:00 AM - 2:00 PM',
            services = [],
            features = [],
            distanceInfo = ''
        } = req.body;

        // Validate required fields
        if (!name?.trim()) {
            res.status(400).json({ error: "Store name is required" });
            return;
        }
        if (!city?.trim()) {
            res.status(400).json({ error: "City is required" });
            return;
        }
        if (!address?.trim()) {
            res.status(400).json({ error: "Address is required" });
            return;
        }
        if (!phone?.trim()) {
            res.status(400).json({ error: "Phone number is required" });
            return;
        }
        if (!email?.trim()) {
            res.status(400).json({ error: "Email is required" });
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.status(400).json({ error: "Invalid email format" });
            return;
        }

        // Check if email already exists
        const existingStore = await prisma.store.findUnique({ where: { email } });
        if (existingStore) {
            res.status(400).json({ error: "Store with this email already exists" });
            return;
        }

        // Check if there's already a main store when trying to create a new one
        if (isMainStore) {
            const existingMainStore = await prisma.store.findFirst({
                where: { isMainStore: true }
            });

            if (existingMainStore) {
                res.status(400).json({
                    error: "A main store already exists",
                    existingMainStoreId: existingMainStore.id,
                    existingMainStoreName: existingMainStore.name
                });
                return;
            }
        }

        // Create the store with all fields
        const store = await prisma.store.create({
            data: {
                name: name.trim(),
                city: city.trim(),
                type: type || 'BRANCH',
                address: address.trim(),
                phone: phone.trim(),
                email: email.trim(),
                isMainStore,
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null,
                weekdayHours: weekdayHours || '8:00 AM - 6:00 PM',
                saturdayHours: saturdayHours || null,
                sundayHours: sundayHours || null,
                services: services || [],
                features: features || [],
                distanceInfo: distanceInfo || null
            },
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: true,
                        users: true
                    }
                }
            }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'STORE_CREATED',
                    entityType: 'STORE',
                    entityId: store.id,
                    details: {
                        storeName: store.name,
                        storeType: store.type,
                        createdBy: req.user.email
                    }
                }
            });
        }

        res.status(201).json(store);
    } catch (error: any) {
        console.error("Create store error:", error);

        // Handle specific Prisma errors
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0];
            res.status(400).json({
                error: `Store with this ${field} already exists`,
                field: field
            });
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
};

export const updateStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;

        const {
            name,
            city,
            type,
            address,
            phone,
            email,
            isMainStore,
            latitude,
            longitude,
            weekdayHours,
            saturdayHours,
            sundayHours,
            services,
            features,
            distanceInfo
        } = req.body;

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // Validate email if being changed
        if (email && email !== store.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                res.status(400).json({ error: "Invalid email format" });
                return;
            }

            const existingStore = await prisma.store.findUnique({ where: { email } });
            if (existingStore) {
                res.status(400).json({ error: "Store with this email already exists" });
                return;
            }
        }

        // Handle main store change logic
        if (isMainStore !== undefined) {
            // If trying to set as main store
            if (isMainStore && !store.isMainStore) {
                const existingMainStore = await prisma.store.findFirst({
                    where: {
                        isMainStore: true,
                        NOT: { id: storeId }
                    }
                });

                if (existingMainStore) {
                    res.status(400).json({
                        error: "A main store already exists",
                        existingMainStoreId: existingMainStore.id,
                        existingMainStoreName: existingMainStore.name
                    });
                    return;
                }
            }
            // If trying to unset main store
            else if (!isMainStore && store.isMainStore) {
                res.status(400).json({
                    error: "Cannot unset main store. Please set another store as main first."
                });
                return;
            }
        }

        // Prepare update data
        const updateData: any = {};
        if (name !== undefined) updateData.name = name.trim();
        if (city !== undefined) updateData.city = city.trim();
        if (type !== undefined) updateData.type = type;
        if (address !== undefined) updateData.address = address.trim();
        if (phone !== undefined) updateData.phone = phone.trim();
        if (email !== undefined) updateData.email = email.trim();
        if (isMainStore !== undefined) updateData.isMainStore = isMainStore;
        if (latitude !== undefined) updateData.latitude = latitude ? parseFloat(latitude) : null;
        if (longitude !== undefined) updateData.longitude = longitude ? parseFloat(longitude) : null;
        if (weekdayHours !== undefined) updateData.weekdayHours = weekdayHours;
        if (saturdayHours !== undefined) updateData.saturdayHours = saturdayHours || null;
        if (sundayHours !== undefined) updateData.sundayHours = sundayHours || null;
        if (services !== undefined) updateData.services = services || [];
        if (features !== undefined) updateData.features = features || [];
        if (distanceInfo !== undefined) updateData.distanceInfo = distanceInfo || null;

        const updatedStore = await prisma.store.update({
            where: { id: storeId },
            data: updateData,
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: true,
                        users: true
                    }
                }
            }
        });

        // Create activity log
        if (req.user?.id) {
            const updatedFields = Object.keys(req.body).filter(key => req.body[key] !== undefined);

            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'STORE_UPDATED',
                    entityType: 'STORE',
                    entityId: storeId,
                    details: {
                        storeName: updatedStore.name,
                        updatedFields,
                        updatedBy: req.user.email
                    }
                }
            });
        }

        res.json(updatedStore);
    } catch (error: any) {
        console.error("Update store error:", error);

        // Handle specific Prisma errors
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0];
            res.status(400).json({
                error: `Store with this ${field} already exists`,
                field: field
            });
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
};

export const deleteStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;

        const store = await prisma.store.findUnique({
            where: { id: storeId },
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: true,
                        users: true,
                        sales: true
                    }
                }
            }
        });

        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // Prevent deletion of main store
        if (store.isMainStore) {
            res.status(400).json({ error: "Cannot delete the main store" });
            return;
        }

        // Prevent deletion if store has related records
        const hasRelatedRecords = Object.values(store._count).some(count => count > 0);
        if (hasRelatedRecords) {
            res.status(400).json({
                error: "Cannot delete store with related records (employees, inventory, sales, or users)"
            });
            return;
        }

        await prisma.store.delete({ where: { id: storeId } });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'STORE_DELETED',
                    entityType: 'STORE',
                    entityId: storeId,
                    details: {
                        storeName: store.name,
                        deletedBy: req.user.email
                    }
                }
            });
        }

        res.json({ message: "Store deleted successfully" });
    } catch (error) {
        console.error("Delete store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Add a new endpoint to set main store
export const setMainStore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // If already main store, return success
        if (store.isMainStore) {
            res.json({
                message: "Store is already the main store",
                store
            });
            return;
        }

        // Get current main store
        const currentMainStore = await prisma.store.findFirst({
            where: { isMainStore: true }
        });

        // Update transaction
        await prisma.$transaction([
            // Unset current main store if exists
            ...(currentMainStore ? [
                prisma.store.update({
                    where: { id: currentMainStore.id },
                    data: { isMainStore: false }
                })
            ] : []),
            // Set new main store
            prisma.store.update({
                where: { id: storeId },
                data: { isMainStore: true }
            })
        ]);

        const updatedStore = await prisma.store.findUnique({
            where: { id: storeId },
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: true,
                        users: true
                    }
                }
            }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'MAIN_STORE_CHANGED',
                    entityType: 'STORE',
                    entityId: storeId,
                    details: {
                        oldMainStore: currentMainStore?.name || null,
                        newMainStore: updatedStore?.name,
                        changedBy: req.user.email
                    }
                }
            });
        }

        res.json({
            message: "Main store updated successfully",
            store: updatedStore,
            oldMainStore: currentMainStore
        });
    } catch (error) {
        console.error("Set main store error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Keep the other functions (getStoreMetrics, getStoreInventory, getStoreSalesTrend) as they are
// ... rest of the functions remain the same ...

export const getStoreMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;
        const { startDate, endDate } = req.query;

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // Date range filter
        const dateFilter: any = {};
        if (startDate) dateFilter.gte = new Date(startDate as string);
        if (endDate) dateFilter.lte = new Date(endDate as string);

        // Get store metrics
        const [
            inventoryMetrics,
            salesMetrics,
            employeeCount,
            recentSales,
            lowStockItems
        ] = await Promise.all([
            // Inventory metrics
            prisma.inventory.aggregate({
                where: { storeId: storeId },
                _sum: { quantity: true, storePrice: true },
                _avg: { storePrice: true }
            }),

            // Sales metrics
            prisma.sale.aggregate({
                where: {
                    storeId: storeId,
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                },
                _sum: { total: true, subtotal: true, tax: true },
                _count: true
            }),

            // Employee count
            prisma.employee.count({
                where: {
                    storeId: storeId,
                    status: 'ACTIVE'
                }
            }),

            // Recent sales
            prisma.sale.findMany({
                where: {
                    storeId: storeId,
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: {
                    employee: {
                        include: { user: true }
                    },
                    saleItems: {
                        include: { product: true }
                    }
                }
            }),

            // Low stock items
            prisma.inventory.findMany({
                where: {
                    storeId: storeId,
                    quantity: { lt: 10 } // Below reorder level
                },
                include: { product: true },
                take: 10
            })
        ]);

        // Calculate inventory value
        const inventories = await prisma.inventory.findMany({
            where: { storeId: storeId },
            include: { product: true }
        });
        const inventoryValue = calculateInventoryMetrics(inventories);

        // Type-safe calculations
        const totalRevenue = salesMetrics._sum?.total || 0;
        const salesCount = salesMetrics._count || 0;
        const averageSale = salesCount > 0 ? totalRevenue / salesCount : 0;
        const totalQuantity = inventoryMetrics._sum?.quantity || 0;
        const averagePrice = inventoryMetrics._avg?.storePrice || 0;

        res.json({
            store,
            metrics: {
                inventory: {
                    totalItems: totalQuantity,
                    averagePrice: averagePrice,
                    totalValue: inventoryValue.totalValue || 0,
                    lowStockCount: lowStockItems.length
                },
                sales: {
                    totalRevenue: totalRevenue,
                    totalSales: salesCount,
                    totalTax: salesMetrics._sum?.tax || 0,
                    averageSale: averageSale
                },
                employees: {
                    activeCount: employeeCount
                }
            },
            recentSales,
            lowStockItems
        });
    } catch (error) {
        console.error("Get store metrics error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getStoreInventory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;
        const {
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc' as 'asc' | 'desc',
            search,
            minQuantity,
            maxQuantity,
            belowReorder,
            type,
            grade
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        // Build the where clause manually
        const where: any = {
            storeId: storeId
        };

        // Add search filter
        if (search) {
            where.OR = [
                { product: { name: { contains: search as string, mode: 'insensitive' } } },
                { product: { tireSize: { contains: search as string, mode: 'insensitive' } } }
            ];
        }

        // Add quantity filters
        if (minQuantity) {
            where.quantity = { ...where.quantity, gte: Number(minQuantity) };
        }
        if (maxQuantity) {
            where.quantity = { ...where.quantity, lte: Number(maxQuantity) };
        }
        if (belowReorder === 'true') {
            where.quantity = { ...where.quantity, lt: 10 }; // Assuming reorder level is 10
        }

        // Add product type and grade filters
        if (type) {
            where.product = { ...where.product, type: type as string };
        }
        if (grade) {
            where.product = { ...where.product, grade: grade as string };
        }

        const [inventory, total] = await Promise.all([
            prisma.inventory.findMany({
                where,
                skip,
                take,
                orderBy: { [sortBy as string]: sortOrder },
                include: {
                    product: true
                }
            }),
            prisma.inventory.count({ where })
        ]);

        // Calculate inventory value for each item
        const inventoryWithValue = inventory.map(item => {
            const price = item.storePrice || (item.product?.basePrice || 0);
            return {
                ...item,
                value: item.quantity * price
            };
        });

        res.json({
            data: inventoryWithValue,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get store inventory error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getStoreSalesTrend = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const storeId = Array.isArray(id) ? id[0] : id;
        const { period = '30d' } = req.query;

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // Calculate date range based on period
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

        // Type-safe raw query results
        type SalesDataRow = {
            date: Date;
            sales_count: number;
            total_revenue: number;
            subtotal: number;
            total_tax: number;
            active_employees: number;
        };

        type ProductRow = {
            id: string;
            name: string;
            type: string;
            total_quantity: number;
            total_revenue: number;
            sales_count: number;
        };

        type PaymentMethodRow = {
            paymentMethod: string;
            transaction_count: number;
            total_revenue: number;
        };

        // Get daily sales data
        const salesData = await prisma.$queryRaw<SalesDataRow[]>`
      SELECT 
        DATE(s."createdAt") as date,
        COUNT(*) as sales_count,
        SUM(s.total) as total_revenue,
        SUM(s.subtotal) as subtotal,
        SUM(s.tax) as total_tax,
        COUNT(DISTINCT s."employeeId") as active_employees
      FROM "Sale" s
      WHERE s."storeId" = ${storeId}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY DATE(s."createdAt")
      ORDER BY date ASC
    `;

        // Get top selling products
        const topProducts = await prisma.$queryRaw<ProductRow[]>`
      SELECT 
        p.id,
        p.name,
        p.type,
        SUM(si.quantity) as total_quantity,
        SUM(si.quantity * si.price) as total_revenue,
        COUNT(DISTINCT si."saleId") as sales_count
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si."productId"
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."storeId" = ${storeId}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY p.id, p.name, p.type
      ORDER BY total_quantity DESC
      LIMIT 10
    `;

        // Get sales by payment method
        const paymentMethods = await prisma.$queryRaw<PaymentMethodRow[]>`
      SELECT 
        "paymentMethod",
        COUNT(*) as transaction_count,
        SUM(total) as total_revenue
      FROM "Sale"
      WHERE "storeId" = ${storeId}
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY "paymentMethod"
      ORDER BY total_revenue DESC
    `;

        // Calculate summary statistics
        const totalDays = salesData.length;
        const averageDailySales = totalDays > 0
            ? salesData.reduce((sum, day) => sum + Number(day.total_revenue), 0) / totalDays
            : 0;

        res.json({
            store,
            period: {
                startDate,
                endDate,
                period
            },
            salesTrend: salesData,
            topProducts,
            paymentMethods,
            summary: {
                totalDays,
                averageDailySales
            }
        });
    } catch (error) {
        console.error("Get store sales trend error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};