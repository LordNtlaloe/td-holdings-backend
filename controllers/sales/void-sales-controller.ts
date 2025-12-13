import { prisma } from "../../lib/prisma";
import { InventoryChangeType } from "@prisma/client";

/**
 * SALES VOID CONTROLLER: Sale voiding and reversal operations
 * 
 * Aggregate Root: VoidedSale
 * Coordinates: Sale, Inventory, InventoryHistory
 * 
 * Key Invariants:
 * 1. Sale can only be voided once
 * 2. All inventory must be restocked
 * 3. Void reason must be provided
 * 4. Only authorized users can void sales
 */

// ============ SALE VOIDING ============

/**
 * Void a sale completely
 * Restocks all inventory and creates void record
 * 
 * @param saleId Sale ID to void
 * @param voidedBy User ID voiding the sale
 * @param reason Reason for voiding (required)
 */
export const voidSale = async (
    saleId: string,
    voidedBy: string,
    reason: string
): Promise<{
    voidedSale: any;
    inventoryUpdates: any[];
    inventoryHistories: any[];
}> => {
    if (!reason || reason.trim().length === 0) {
        throw new Error("REASON_REQUIRED: Reason is required to void a sale");
    }

    // Transaction: Validate + void + restock atomically
    return await prisma.$transaction(async (tx) => {
        // Get sale with all items
        const sale = await tx.sale.findUnique({
            where: { id: saleId },
            include: {
                saleItems: {
                    include: {
                        product: true
                    }
                },
                store: true,
                voidedSale: true
            }
        });

        if (!sale) {
            throw new Error("SALE_NOT_FOUND: Sale does not exist");
        }

        // Check if already voided
        if (sale.voidedSale) {
            throw new Error("SALE_ALREADY_VOIDED: This sale has already been voided");
        }

        // Check if sale is too old (e.g., > 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (sale.createdAt < thirtyDaysAgo) {
            throw new Error("SALE_TOO_OLD: Cannot void sales older than 30 days");
        }

        const inventoryUpdates = [];
        const inventoryHistories = [];

        // Restock inventory for each item
        for (const saleItem of sale.saleItems) {
            // Get or create inventory record
            let inventory = await tx.inventory.findUnique({
                where: {
                    productId_storeId: {
                        productId: saleItem.productId,
                        storeId: sale.storeId
                    }
                }
            });

            if (!inventory) {
                // Create inventory record if it doesn't exist
                inventory = await tx.inventory.create({
                    data: {
                        productId: saleItem.productId,
                        storeId: sale.storeId,
                        quantity: saleItem.quantity,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                });
            } else {
                // Update existing inventory
                inventory = await tx.inventory.update({
                    where: {
                        productId_storeId: {
                            productId: saleItem.productId,
                            storeId: sale.storeId
                        }
                    },
                    data: {
                        quantity: { increment: saleItem.quantity },
                        updatedAt: new Date()
                    }
                });
            }

            inventoryUpdates.push(inventory);

            // Create inventory history
            const history = await tx.inventoryHistory.create({
                data: {
                    inventoryId: inventory.id,
                    changeType: InventoryChangeType.RETURN, // Using RETURN for void restocking
                    quantityChange: saleItem.quantity,
                    previousQuantity: inventory.quantity - saleItem.quantity,
                    newQuantity: inventory.quantity,
                    referenceId: saleId,
                    referenceType: "SALE_VOID",
                    notes: `Sale voided: ${reason}`,
                    createdBy: voidedBy,
                    createdAt: new Date()
                }
            });

            inventoryHistories.push(history);
        }

        // Create voided sale record
        const voidedSale = await tx.voidedSale.create({
            data: {
                saleId,
                voidedBy,
                reason,
                originalTotal: sale.total,
                createdAt: new Date()
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: voidedBy,
                action: "SALE_VOIDED",
                entityType: "SALE",
                entityId: saleId,
                details: {
                    reason,
                    originalTotal: sale.total,
                    itemCount: sale.saleItems.length
                },
                createdAt: new Date()
            }
        });

        return {
            voidedSale,
            inventoryUpdates,
            inventoryHistories
        };
    });
};

/**
 * Get voided sale details
 * 
 * @param voidedSaleId Voided sale ID
 */
export const getVoidedSaleDetails = async (
    voidedSaleId: string
): Promise<any> => {
    const voidedSale = await prisma.voidedSale.findUnique({
        where: { id: voidedSaleId },
        include: {
            sale: {
                include: {
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
                    },
                    store: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    saleItems: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!voidedSale) {
        throw new Error("VOIDED_SALE_NOT_FOUND: Voided sale record does not exist");
    }

    return voidedSale;
};

/**
 * Get all voided sales with filters
 * 
 * @param filters Void filters
 * @param page Page number
 * @param limit Items per page
 */
export const getVoidedSales = async (
    filters: {
        storeId?: string;
        dateFrom?: Date;
        dateTo?: Date;
        voidedBy?: string;
        reasonContains?: string;
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    voidedSales: any[];
    total: number;
    page: number;
    totalPages: number;
    summary: {
        totalVoids: number;
        totalAmountVoided: number;
        averageVoidAmount: number;
    };
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.storeId) {
        whereCondition.sale = { storeId: filters.storeId };
    }
    if (filters.dateFrom || filters.dateTo) {
        whereCondition.createdAt = {};
        if (filters.dateFrom) whereCondition.createdAt.gte = filters.dateFrom;
        if (filters.dateTo) whereCondition.createdAt.lte = filters.dateTo;
    }
    if (filters.voidedBy) {
        whereCondition.voidedBy = filters.voidedBy;
    }
    if (filters.reasonContains) {
        whereCondition.reason = { contains: filters.reasonContains, mode: 'insensitive' };
    }

    const [voidedSales, total, allFilteredVoids] = await Promise.all([
        prisma.voidedSale.findMany({
            where: whereCondition,
            include: {
                sale: {
                    include: {
                        store: {
                            select: { id: true, name: true }
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
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.voidedSale.count({ where: whereCondition }),
        prisma.voidedSale.findMany({
            where: whereCondition,
            select: {
                id: true,
                originalTotal: true
            }
        })
    ]);

    // Calculate summary statistics
    const summary = {
        totalVoids: allFilteredVoids.length,
        totalAmountVoided: allFilteredVoids.reduce((sum, v) => sum + v.originalTotal, 0),
        averageVoidAmount: allFilteredVoids.length > 0
            ? allFilteredVoids.reduce((sum, v) => sum + v.originalTotal, 0) / allFilteredVoids.length
            : 0
    };

    const totalPages = Math.ceil(total / limit);

    return {
        voidedSales,
        total,
        page,
        totalPages,
        summary
    };
};

/**
 * Get void statistics
 * 
 * @param storeId Optional store filter
 * @param dateFrom Optional start date
 * @param dateTo Optional end date
 */
export const getVoidStatistics = async (
    storeId?: string,
    dateFrom?: Date,
    dateTo?: Date
): Promise<{
    totalVoids: number;
    totalAmountVoided: number;
    voidsByReason: Array<{ reason: string; count: number; totalAmount: number }>;
    voidsByEmployee: Array<{ employeeId: string; employeeName: string; count: number; totalAmount: number }>;
    voidsByStore: Array<{ storeId: string; storeName: string; count: number; totalAmount: number }>;
}> => {
    // Build where condition
    const whereCondition: any = {};

    if (storeId) {
        whereCondition.sale = { storeId };
    }
    if (dateFrom || dateTo) {
        whereCondition.createdAt = {};
        if (dateFrom) whereCondition.createdAt.gte = dateFrom;
        if (dateTo) whereCondition.createdAt.lte = dateTo;
    }

    const voidedSales = await prisma.voidedSale.findMany({
        where: whereCondition,
        include: {
            sale: {
                include: {
                    store: {
                        select: { id: true, name: true }
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
            }
        }
    });

    // Calculate basic statistics
    const totalVoids = voidedSales.length;
    const totalAmountVoided = voidedSales.reduce((sum, v) => sum + v.originalTotal, 0);

    // Group by reason
    const reasonMap = new Map<string, { count: number; totalAmount: number }>();
    voidedSales.forEach(v => {
        const reason = v.reason || 'No reason provided';
        if (!reasonMap.has(reason)) {
            reasonMap.set(reason, { count: 0, totalAmount: 0 });
        }
        const data = reasonMap.get(reason)!;
        data.count++;
        data.totalAmount += v.originalTotal;
    });

    // Group by employee
    const employeeMap = new Map<string, { name: string; count: number; totalAmount: number }>();
    voidedSales.forEach(v => {
        const employee = v.sale.employee;
        const employeeKey = employee.id;
        if (!employeeMap.has(employeeKey)) {
            employeeMap.set(employeeKey, {
                name: `${employee.user.firstName} ${employee.user.lastName}`,
                count: 0,
                totalAmount: 0
            });
        }
        const data = employeeMap.get(employeeKey)!;
        data.count++;
        data.totalAmount += v.originalTotal;
    });

    // Group by store
    const storeMap = new Map<string, { name: string; count: number; totalAmount: number }>();
    voidedSales.forEach(v => {
        const store = v.sale.store;
        const storeKey = store.id;
        if (!storeMap.has(storeKey)) {
            storeMap.set(storeKey, {
                name: store.name,
                count: 0,
                totalAmount: 0
            });
        }
        const data = storeMap.get(storeKey)!;
        data.count++;
        data.totalAmount += v.originalTotal;
    });

    return {
        totalVoids,
        totalAmountVoided,
        voidsByReason: Array.from(reasonMap.entries())
            .map(([reason, data]) => ({
                reason,
                count: data.count,
                totalAmount: data.totalAmount
            }))
            .sort((a, b) => b.count - a.count),
        voidsByEmployee: Array.from(employeeMap.entries())
            .map(([id, data]) => ({
                employeeId: id,
                employeeName: data.name,
                count: data.count,
                totalAmount: data.totalAmount
            }))
            .sort((a, b) => b.count - a.count),
        voidsByStore: Array.from(storeMap.entries())
            .map(([id, data]) => ({
                storeId: id,
                storeName: data.name,
                count: data.count,
                totalAmount: data.totalAmount
            }))
            .sort((a, b) => b.count - a.count)
    };
};

/**
 * Validate if a sale can be voided
 * 
 * @param saleId Sale ID to check
 */
export const validateSaleCanBeVoided = async (
    saleId: string
): Promise<{
    canBeVoided: boolean;
    reasons?: string[];
    warnings?: string[];
}> => {
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            voidedSale: true,
            saleItems: {
                include: {
                    product: true
                }
            },
        }
    });

    if (!sale) {
        return {
            canBeVoided: false,
            reasons: ["SALE_NOT_FOUND: Sale does not exist"]
        };
    }

    const reasons = [];
    const warnings = [];

    // Check if already voided
    if (sale.voidedSale) {
        reasons.push("ALREADY_VOIDED: This sale has already been voided");
    }

    // Check if sale is too old
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (sale.createdAt < thirtyDaysAgo) {
        warnings.push("SALE_OLD: Sale is older than 30 days");
    }

    // Check if any products have been discontinued (in a real system)
    // This would require a discontinued flag on products

    const canBeVoided = reasons.length === 0;

    return {
        canBeVoided,
        reasons: reasons.length > 0 ? reasons : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
    };
};