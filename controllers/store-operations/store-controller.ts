import { prisma } from "../../lib/prisma";

/**
 * STORE OPERATIONS CONTROLLER: Store management and configuration
 * 
 * Aggregate Root: Store
 * Supporting: StoreProduct, User (store assignments)
 * 
 * Key Invariants:
 * 1. Only one main store can exist
 * 2. Store email must be unique
 * 3. Store cannot be deleted if it has inventory, sales, or employees
 */

// ============ STORE CREATION & MANAGEMENT ============

/**
 * Create a new store
 * 
 * @param name Store name
 * @param location Store location
 * @param phone Store phone number
 * @param email Store email (must be unique)
 * @param isMainStore Whether this is the main store
 * @param createdBy User ID creating the store
 */
export const createStore = async (
    name: string,
    location: string,
    phone: string,
    email: string,
    isMainStore: boolean = false,
    createdBy: string
): Promise<{ store: any }> => {
    // Validate inputs
    if (!name || !location || !phone || !email) {
        throw new Error("MISSING_REQUIRED_FIELDS: Name, location, phone, and email are required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error("INVALID_EMAIL_FORMAT: Please provide a valid email address");
    }

    // Transaction: Validate + create store atomically
    return await prisma.$transaction(async (tx) => {
        // Check if store email already exists
        const existingStore = await tx.store.findUnique({ where: { email } });
        if (existingStore) {
            throw new Error("STORE_EXISTS: A store with this email already exists");
        }

        // If setting as main store, check if another main store exists
        if (isMainStore) {
            const existingMainStore = await tx.store.findFirst({
                where: { isMainStore: true }
            });
            if (existingMainStore) {
                throw new Error(
                    `MAIN_STORE_EXISTS: Store ${existingMainStore.name} is already set as main store`
                );
            }
        }

        // Create store
        const store = await tx.store.create({
            data: {
                name,
                location,
                phone,
                email,
                isMainStore,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: createdBy,
                action: "STORE_CREATED",
                entityType: "STORE",
                entityId: store.id,
                details: { name, location, isMainStore },
                createdAt: new Date()
            }
        });

        return { store };
    });
};

/**
 * Update store details
 * 
 * @param storeId Store ID to update
 * @param updates Fields to update
 * @param updatedBy User ID making update
 */
export const updateStore = async (
    storeId: string,
    updates: {
        name?: string;
        location?: string;
        phone?: string;
        email?: string;
        isMainStore?: boolean;
    },
    updatedBy: string
): Promise<{ store: any; changes: string[] }> => {
    // Validate at least one field is being updated
    if (Object.keys(updates).length === 0) {
        throw new Error("NO_UPDATES_PROVIDED: At least one field must be updated");
    }

    if (updates.email) {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.email)) {
            throw new Error("INVALID_EMAIL_FORMAT: Please provide a valid email address");
        }
    }

    // Transaction: Validate + update store atomically
    return await prisma.$transaction(async (tx) => {
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) {
            throw new Error("STORE_NOT_FOUND: Store does not exist");
        }

        const changes = [];

        // Check email uniqueness if changing email
        if (updates.email && updates.email !== store.email) {
            const existingStore = await tx.store.findUnique({ where: { email: updates.email } });
            if (existingStore) {
                throw new Error("STORE_EXISTS: Another store with this email already exists");
            }
            changes.push(`email: ${store.email} → ${updates.email}`);
        }

        // Handle main store logic
        if (updates.isMainStore !== undefined && updates.isMainStore !== store.isMainStore) {
            if (updates.isMainStore) {
                // Setting this as main store
                const existingMainStore = await tx.store.findFirst({
                    where: {
                        isMainStore: true,
                        id: { not: storeId }
                    }
                });
                if (existingMainStore) {
                    // Demote existing main store
                    await tx.store.update({
                        where: { id: existingMainStore.id },
                        data: { isMainStore: false, updatedAt: new Date() }
                    });
                    changes.push(`demoted main store: ${existingMainStore.name}`);
                }
                changes.push(`set as main store: ${store.isMainStore} → ${updates.isMainStore}`);
            } else {
                // Cannot unset main store if it's the only one
                if (store.isMainStore) {
                    const otherStores = await tx.store.count({
                        where: {
                            id: { not: storeId }
                        }
                    });
                    if (otherStores === 0) {
                        throw new Error("CANNOT_UNSET_MAIN_STORE: This is the only store, cannot unset as main store");
                    }
                }
                changes.push(`unset as main store`);
            }
        }

        // Update store
        const updatedStore = await tx.store.update({
            where: { id: storeId },
            data: {
                ...updates,
                updatedAt: new Date()
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: updatedBy,
                action: "STORE_UPDATED",
                entityType: "STORE",
                entityId: storeId,
                details: { changes },
                createdAt: new Date()
            }
        });

        return { store: updatedStore, changes };
    });
};

/**
 * Get store details with statistics
 * 
 * @param storeId Store ID
 */
export const getStoreDetails = async (
    storeId: string
): Promise<any> => {
    const store = await prisma.store.findUnique({
        where: { id: storeId },
        include: {
            _count: {
                select: {
                    employees: true,
                    inventories: true,
                    sales: true,
                    storeProducts: true
                }
            },
            employees: {
                take: 5,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true
                        }
                    }
                }
            }
        }
    });

    if (!store) {
        throw new Error("STORE_NOT_FOUND: Store does not exist");
    }

    // Get additional statistics
    const [inventoryStats, salesStats, recentSales] = await Promise.all([
        // Inventory statistics
        prisma.inventory.aggregate({
            where: { storeId },
            _sum: { quantity: true },
            _avg: { storePrice: true }
        }),
        // Sales statistics (last 30 days)
        prisma.sale.aggregate({
            where: {
                storeId,
                createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                }
            },
            _sum: { total: true },
            _count: true
        }),
        // Recent sales
        prisma.sale.findMany({
            where: { storeId },
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                total: true,
                createdAt: true,
                paymentMethod: true,
                employee: {
                    select: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                }
            }
        })
    ]);

    return {
        ...store,
        statistics: {
            inventory: {
                totalItems: inventoryStats._sum.quantity || 0,
                averagePrice: inventoryStats._avg.storePrice || 0
            },
            sales: {
                last30Days: {
                    totalRevenue: salesStats._sum.total || 0,
                    transactionCount: salesStats._count || 0,
                    averageTransaction: salesStats._count > 0
                        ? (salesStats._sum.total || 0) / salesStats._count
                        : 0
                }
            }
        },
        recentSales
    };
};

/**
 * Get all stores with optional filters
 * 
 * @param filters Store filters
 * @param page Page number
 * @param limit Items per page
 */
export const getStores = async (
    filters: {
        isMainStore?: boolean;
        search?: string;
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    stores: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.isMainStore !== undefined) {
        whereCondition.isMainStore = filters.isMainStore;
    }

    if (filters.search) {
        whereCondition.OR = [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { location: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } }
        ];
    }

    const [stores, total] = await Promise.all([
        prisma.store.findMany({
            where: whereCondition,
            include: {
                _count: {
                    select: {
                        employees: true,
                        inventories: {
                            where: { quantity: { gt: 0 } }
                        },
                        sales: true
                    }
                }
            },
            orderBy: [
                { isMainStore: 'desc' },
                { name: 'asc' }
            ],
            skip,
            take: limit
        }),
        prisma.store.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        stores,
        total,
        page,
        totalPages
    };
};

/**
 * Get main store details
 */
export const getMainStore = async (): Promise<any> => {
    const mainStore = await prisma.store.findFirst({
        where: { isMainStore: true },
        include: {
            _count: {
                select: {
                    employees: true,
                    inventories: true,
                    sales: true
                }
            }
        }
    });

    if (!mainStore) {
        throw new Error("MAIN_STORE_NOT_FOUND: No main store configured");
    }

    return mainStore;
};

/**
 * Set a store as main store
 * Demotes existing main store if any
 * 
 * @param storeId Store ID to set as main
 * @param setBy User ID setting the main store
 */
export const setMainStore = async (
    storeId: string,
    setBy: string
): Promise<{ newMainStore: any; oldMainStore?: any }> => {
    // Transaction: Demote old + promote new atomically
    return await prisma.$transaction(async (tx) => {
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) {
            throw new Error("STORE_NOT_FOUND: Store does not exist");
        }

        // Check if already main store
        if (store.isMainStore) {
            throw new Error("ALREADY_MAIN_STORE: Store is already the main store");
        }

        // Find and demote existing main store
        const oldMainStore = await tx.store.findFirst({
            where: { isMainStore: true }
        });

        if (oldMainStore) {
            await tx.store.update({
                where: { id: oldMainStore.id },
                data: { isMainStore: false, updatedAt: new Date() }
            });
        }

        // Set new main store
        const newMainStore = await tx.store.update({
            where: { id: storeId },
            data: { isMainStore: true, updatedAt: new Date() }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: setBy,
                action: "MAIN_STORE_CHANGED",
                entityType: "STORE",
                entityId: storeId,
                details: {
                    newMainStore: store.name,
                    oldMainStore: oldMainStore?.name
                },
                createdAt: new Date()
            }
        });

        return { newMainStore, oldMainStore };
    });
};

/**
 * Get store inventory summary
 * 
 * @param storeId Store ID
 */
export const getStoreInventorySummary = async (
    storeId: string
): Promise<{
    store: any;
    summary: {
        totalProducts: number;
        totalQuantity: number;
        totalValue: number;
        lowStockProducts: number;
        outOfStockProducts: number;
    };
    categories: Array<{
        type: string;
        count: number;
        quantity: number;
        value: number;
    }>;
}> => {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
        throw new Error("STORE_NOT_FOUND: Store does not exist");
    }

    // Get all inventory for this store with product details
    const inventories = await prisma.inventory.findMany({
        where: { storeId },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    basePrice: true
                }
            }
        }
    });

    // Calculate summary
    let totalProducts = 0;
    let totalQuantity = 0;
    let totalValue = 0;
    let lowStockProducts = 0;
    let outOfStockProducts = 0;

    const categoryMap = new Map<string, { count: number; quantity: number; value: number }>();

    inventories.forEach(inv => {
        totalProducts++;
        totalQuantity += inv.quantity;

        const value = inv.storePrice ? inv.quantity * inv.storePrice : inv.quantity * inv.product.basePrice;
        totalValue += value;

        // Check stock levels
        if (inv.quantity === 0) {
            outOfStockProducts++;
        } else if (inv.reorderLevel && inv.quantity <= inv.reorderLevel) {
            lowStockProducts++;
        }

        // Group by product type
        const type = inv.product.type;
        if (!categoryMap.has(type)) {
            categoryMap.set(type, { count: 0, quantity: 0, value: 0 });
        }
        const category = categoryMap.get(type)!;
        category.count++;
        category.quantity += inv.quantity;
        category.value += value;
    });

    return {
        store,
        summary: {
            totalProducts,
            totalQuantity,
            totalValue,
            lowStockProducts,
            outOfStockProducts
        },
        categories: Array.from(categoryMap.entries()).map(([type, data]) => ({
            type,
            count: data.count,
            quantity: data.quantity,
            value: data.value
        }))
    };
};

/**
 * Get store performance metrics
 * 
 * @param storeId Store ID
 * @param period Time period (day, week, month, year)
 */
export const getStorePerformance = async (
    storeId: string,
    period: 'day' | 'week' | 'month' | 'year'
): Promise<{
    store: any;
    period: string;
    sales: {
        revenue: number;
        transactions: number;
        averageTransaction: number;
        bestSellingProducts: Array<{ productId: string; productName: string; quantity: number; revenue: number }>;
        topEmployees: Array<{ employeeId: string; employeeName: string; sales: number; revenue: number }>;
    };
    inventory: {
        turnoverRate: number;
        daysOfInventory: number;
        stockOutRate: number;
    };
}> => {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
        throw new Error("STORE_NOT_FOUND: Store does not exist");
    }

    const now = new Date();
    let startDate: Date;

    switch (period) {
        case 'day':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    // Get sales data for period
    const sales = await prisma.sale.findMany({
        where: {
            storeId,
            createdAt: {
                gte: startDate,
                lte: now
            }
        },
        include: {
            saleItems: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            },
            employee: {
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true
                        }
                    }
                }
            }
        }
    });

    // Calculate sales metrics
    const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const transactions = sales.length;
    const averageTransaction = transactions > 0 ? revenue / transactions : 0;

    // Group by product
    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    sales.forEach(sale => {
        sale.saleItems.forEach(item => {
            const productKey = item.productId;
            if (!productMap.has(productKey)) {
                productMap.set(productKey, {
                    name: item.product.name,
                    quantity: 0,
                    revenue: 0
                });
            }
            const productData = productMap.get(productKey)!;
            productData.quantity += item.quantity;
            productData.revenue += item.price * item.quantity;
        });
    });

    // Group by employee
    const employeeMap = new Map<string, { name: string; sales: number; revenue: number }>();
    sales.forEach(sale => {
        const employeeKey = sale.employeeId;
        if (!employeeMap.has(employeeKey)) {
            employeeMap.set(employeeKey, {
                name: `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                sales: 0,
                revenue: 0
            });
        }
        const employeeData = employeeMap.get(employeeKey)!;
        employeeData.sales++;
        employeeData.revenue += sale.total;
    });

    // Get inventory data for turnover calculation
    const inventory = await prisma.inventory.findMany({
        where: { storeId },
        include: {
            product: true,
            histories: {
                where: {
                    changeType: { in: ["SALE", "TRANSFER_OUT"] },
                    createdAt: { gte: startDate }
                }
            }
        }
    });

    // Calculate inventory metrics
    let totalInventoryValue = 0;
    let totalCostOfGoodsSold = 0;

    inventory.forEach(inv => {
        const cost = inv.storePrice || inv.product.basePrice;
        totalInventoryValue += inv.quantity * cost;

        // Sum up cost of goods sold from history
        const goodsSold = inv.histories.reduce((sum, hist) => {
            if (hist.quantityChange < 0) { // Sales and transfers out
                return sum + (Math.abs(hist.quantityChange) * cost);
            }
            return sum;
        }, 0);
        totalCostOfGoodsSold += goodsSold;
    });

    const turnoverRate = totalInventoryValue > 0 ? totalCostOfGoodsSold / totalInventoryValue : 0;
    const daysOfInventory = turnoverRate > 0 ? 365 / turnoverRate : 0;

    // Calculate stock-out rate (simplified)
    const outOfStockProducts = inventory.filter(inv => inv.quantity === 0).length;
    const stockOutRate = inventory.length > 0 ? outOfStockProducts / inventory.length : 0;

    return {
        store,
        period,
        sales: {
            revenue,
            transactions,
            averageTransaction,
            bestSellingProducts: Array.from(productMap.entries())
                .map(([id, data]) => ({
                    productId: id,
                    productName: data.name,
                    quantity: data.quantity,
                    revenue: data.revenue
                }))
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 10),
            topEmployees: Array.from(employeeMap.entries())
                .map(([id, data]) => ({
                    employeeId: id,
                    employeeName: data.name,
                    sales: data.sales,
                    revenue: data.revenue
                }))
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 10)
        },
        inventory: {
            turnoverRate,
            daysOfInventory,
            stockOutRate
        }
    };
};