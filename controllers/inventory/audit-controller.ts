import { prisma } from "../../lib/prisma";
import { InventoryChangeType, SortOrder } from "@prisma/client";

/**
 * INVENTORY AUDIT CONTROLLER: History tracking and audit operations
 * 
 * Owns: InventoryHistory
 * Reads: Inventory, Product, Store, User
 * 
 * Key Responsibility: Provide audit trail for all inventory changes
 */

/**
 * Get inventory history for a specific inventory record
 * 
 * @param inventoryId Inventory record ID
 * @param page Page number (1-based)
 * @param limit Items per page
 * @param startDate Optional start date filter
 * @param endDate Optional end date filter
 * @param changeTypes Optional filter by change types
 */
export const getInventoryHistory = async (
    inventoryId: string,
    page: number = 1,
    limit: number = 50,
    startDate?: Date,
    endDate?: Date,
    changeTypes?: InventoryChangeType[]
): Promise<{
    history: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    const whereCondition: any = { inventoryId };

    if (startDate || endDate) {
        whereCondition.createdAt = {};
        if (startDate) whereCondition.createdAt.gte = startDate;
        if (endDate) whereCondition.createdAt.lte = endDate;
    }

    if (changeTypes && changeTypes.length > 0) {
        whereCondition.changeType = { in: changeTypes };
    }

    const [history, total] = await Promise.all([
        prisma.inventoryHistory.findMany({
            where: whereCondition,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true
                    }
                },
                inventory: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        store: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.inventoryHistory.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        history,
        total,
        page,
        totalPages
    };
};

/**
 * Get inventory change summary for reporting
 * 
 * @param inventoryId Inventory record ID
 * @param startDate Start date for period
 * @param endDate End date for period
 */
export const getInventoryChangeSummary = async (
    inventoryId: string,
    startDate: Date,
    endDate: Date
): Promise<{
    inventory: any;
    summary: any;
    changesByType: Record<InventoryChangeType, number>;
}> => {
    const [inventory, changes] = await Promise.all([
        prisma.inventory.findUnique({
            where: { id: inventoryId },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        basePrice: true
                    }
                },
                store: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        }),
        prisma.inventoryHistory.findMany({
            where: {
                inventoryId,
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            },
            orderBy: { createdAt: 'asc' }
        })
    ]);

    if (!inventory) {
        throw new Error("INVENTORY_NOT_FOUND");
    }

    // Calculate summary
    let totalIncrease = 0;
    let totalDecrease = 0;
    const changesByType: Record<InventoryChangeType, number> = {} as any;

    // Initialize all change types to 0
    Object.values(InventoryChangeType).forEach(type => {
        changesByType[type] = 0;
    });

    changes.forEach(change => {
        changesByType[change.changeType] += change.quantityChange;

        if (change.quantityChange > 0) {
            totalIncrease += change.quantityChange;
        } else {
            totalDecrease += Math.abs(change.quantityChange);
        }
    });

    const netChange = totalIncrease - totalDecrease;

    return {
        inventory,
        summary: {
            periodStart: startDate,
            periodEnd: endDate,
            totalChanges: changes.length,
            totalIncrease,
            totalDecrease,
            netChange,
            startQuantity: changes[0]?.previousQuantity || inventory.quantity - netChange,
            endQuantity: inventory.quantity
        },
        changesByType
    };
};

/**
 * Get stock movement report across multiple stores
 * 
 * @param storeIds Array of store IDs to include (empty for all stores)
 * @param productIds Array of product IDs to include (empty for all products)
 * @param startDate Start date for report
 * @param endDate End date for report
 * @param changeTypes Optional filter by change types
 */
export const getStockMovementReport = async (
    storeIds: string[],
    productIds: string[],
    startDate: Date,
    endDate: Date,
    changeTypes?: InventoryChangeType[]
): Promise<Array<{
    productId: string;
    productName: string;
    storeId: string;
    storeName: string;
    openingStock: number;
    closingStock: number;
    totalReceived: number;
    totalSold: number;
    totalTransferredOut: number;
    totalTransferredIn: number;
    totalAdjusted: number;
    netChange: number;
}>> => {
    // Build where condition
    const whereCondition: any = {
        createdAt: {
            gte: startDate,
            lte: endDate
        }
    };

    if (storeIds.length > 0) {
        whereCondition.inventory = {
            storeId: { in: storeIds }
        };
    }

    if (productIds.length > 0) {
        whereCondition.inventory = {
            ...whereCondition.inventory,
            productId: { in: productIds }
        };
    }

    if (changeTypes && changeTypes.length > 0) {
        whereCondition.changeType = { in: changeTypes };
    }

    // Get all history records for the period
    const history = await prisma.inventoryHistory.findMany({
        where: whereCondition,
        include: {
            inventory: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    store: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    });

    // Group by product-store combination
    const grouped = new Map<string, any>();

    // First pass: Process all changes
    history.forEach(record => {
        const key = `${record.inventory.productId}-${record.inventory.storeId}`;

        if (!grouped.has(key)) {
            grouped.set(key, {
                productId: record.inventory.productId,
                productName: record.inventory.product.name,
                storeId: record.inventory.storeId,
                storeName: record.inventory.store.name,
                openingStock: 0,
                closingStock: 0,
                totalReceived: 0,
                totalSold: 0,
                totalTransferredOut: 0,
                totalTransferredIn: 0,
                totalAdjusted: 0,
                changes: [] as any[]
            });
        }

        const group = grouped.get(key)!;
        group.changes.push(record);

        // Categorize by change type
        switch (record.changeType) {
            case InventoryChangeType.PURCHASE:
            case InventoryChangeType.RETURN:
                group.totalReceived += Math.max(0, record.quantityChange);
                break;
            case InventoryChangeType.SALE:
                group.totalSold += Math.abs(Math.min(0, record.quantityChange));
                break;
            case InventoryChangeType.TRANSFER_OUT:
                group.totalTransferredOut += Math.abs(Math.min(0, record.quantityChange));
                break;
            case InventoryChangeType.TRANSFER_IN:
                group.totalTransferredIn += Math.max(0, record.quantityChange);
                break;
            case InventoryChangeType.ADJUSTMENT:
            case InventoryChangeType.DAMAGE:
                group.totalAdjusted += record.quantityChange;
                break;
        }
    });

    // Second pass: Calculate opening and closing stock
    const results = [];

    for (const [key, data] of grouped.entries()) {
        // Sort changes by timestamp
        data.changes.sort((a: any, b: any) =>
            a.createdAt.getTime() - b.createdAt.getTime()
        );

        // Opening stock is the quantity before first change
        data.openingStock = data.changes[0]?.previousQuantity || 0;

        // Closing stock is the quantity after last change
        const lastChange = data.changes[data.changes.length - 1];
        data.closingStock = lastChange?.newQuantity || data.openingStock;

        // Calculate net change
        data.netChange = data.totalReceived - data.totalSold - data.totalTransferredOut + data.totalTransferredIn + data.totalAdjusted;

        // Remove changes array from result
        delete data.changes;

        results.push(data);
    }

    return results;
};

/**
 * Get audit trail for a specific reference (e.g., sale, transfer)
 * 
 * @param referenceId Reference ID to lookup
 * @param referenceType Reference type (e.g., "SALE", "TRANSFER")
 */
export const getAuditTrailByReference = async (
    referenceId: string,
    referenceType: string
): Promise<any[]> => {
    return await prisma.inventoryHistory.findMany({
        where: {
            referenceId,
            referenceType
        },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true
                }
            },
            inventory: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    store: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    });
};

/**
 * Export inventory history to CSV format
 * 
 * @param inventoryId Optional specific inventory
 * @param startDate Start date for export
 * @param endDate End date for export
 */
export const exportInventoryHistory = async (
    inventoryId?: string,
    startDate?: Date,
    endDate?: Date
): Promise<Array<{
    timestamp: string;
    productId: string;
    productName: string;
    storeId: string;
    storeName: string;
    changeType: string;
    quantityChange: number;
    previousQuantity: number;
    newQuantity: number;
    referenceId?: string;
    referenceType?: string;
    notes?: string;
    performedBy: string;
    performerEmail: string;
}>> => {
    const whereCondition: any = {};

    if (inventoryId) {
        whereCondition.inventoryId = inventoryId;
    }

    if (startDate || endDate) {
        whereCondition.createdAt = {};
        if (startDate) whereCondition.createdAt.gte = startDate;
        if (endDate) whereCondition.createdAt.lte = endDate;
    }

    const history = await prisma.inventoryHistory.findMany({
        where: whereCondition,
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true
                }
            },
            inventory: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    store: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: 10000 // Limit export size
    });

    return history.map(record => ({
        timestamp: record.createdAt.toISOString(),
        productId: record.inventory.productId,
        productName: record.inventory.product.name,
        storeId: record.inventory.storeId,
        storeName: record.inventory.store.name,
        changeType: record.changeType,
        quantityChange: record.quantityChange,
        previousQuantity: record.previousQuantity,
        newQuantity: record.newQuantity,
        referenceId: record.referenceId || undefined,
        referenceType: record.referenceType || undefined,
        notes: record.notes || undefined,
        performedBy: `${record.user.firstName} ${record.user.lastName}`,
        performerEmail: record.user.email
    }));
};

/**
 * Validate inventory data integrity
 * Checks for consistency between inventory quantities and history
 * 
 * @param inventoryId Optional specific inventory to validate
 */
export const validateInventoryIntegrity = async (
    inventoryId?: string
): Promise<Array<{
    inventoryId: string;
    productName: string;
    storeName: string;
    currentQuantity: number;
    calculatedQuantity: number;
    discrepancy: number;
    isValid: boolean;
}>> => {
    const whereCondition: any = {};
    if (inventoryId) {
        whereCondition.id = inventoryId;
    }

    const inventories = await prisma.inventory.findMany({
        where: whereCondition,
        include: {
            product: {
                select: {
                    id: true,
                    name: true
                }
            },
            store: {
                select: {
                    id: true,
                    name: true
                }
            },
            histories: {
                orderBy: { createdAt: 'desc' },
                take: 1
            }
        }
    });

    const results = [];

    for (const inventory of inventories) {
        // Calculate what the quantity should be based on history
        const allHistory = await prisma.inventoryHistory.findMany({
            where: { inventoryId: inventory.id },
            orderBy: { createdAt: 'asc' }
        });

        let calculatedQuantity = 0;

        if (allHistory.length > 0) {
            // Start from the first recorded quantity
            const firstRecord = allHistory[0];
            calculatedQuantity = firstRecord.previousQuantity + firstRecord.quantityChange;

            // Add/subtract all subsequent changes
            for (let i = 1; i < allHistory.length; i++) {
                calculatedQuantity += allHistory[i].quantityChange;
            }
        }

        const discrepancy = inventory.quantity - calculatedQuantity;
        const isValid = discrepancy === 0;

        results.push({
            inventoryId: inventory.id,
            productName: inventory.product.name,
            storeName: inventory.store.name,
            currentQuantity: inventory.quantity,
            calculatedQuantity,
            discrepancy,
            isValid
        });
    }

    return results;
};