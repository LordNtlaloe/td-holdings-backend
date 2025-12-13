import { prisma } from "../../lib/prisma";
import { TransferStatus, InventoryChangeType } from "@prisma/client";

/**
 * SUPPLY CHAIN TRANSFER CONTROLLER: Product transfers between stores
 * 
 * Aggregate Root: ProductTransfer
 * Coordinates: Inventory (source and destination)
 * 
 * Key Invariants:
 * 1. Source must have sufficient inventory
 * 2. Stores must be different
 * 3. Transfers must go through state machine (PENDING → COMPLETED/CANCELLED)
 * 4. Quantity must be positive
 */

// ============ TRANSFER INITIATION ============

/**
 * Initiate a product transfer between stores
 * Creates PENDING transfer and validates source inventory
 * 
 * @param productId Product to transfer
 * @param fromStoreId Source store ID
 * @param toStoreId Destination store ID
 * @param quantity Quantity to transfer (must be > 0)
 * @param initiatedBy User ID initiating transfer
 * @param reason Optional reason for transfer
 * @param notes Optional notes
 */
export const initiateTransfer = async (
    productId: string,
    fromStoreId: string,
    toStoreId: string,
    quantity: number,
    initiatedBy: string,
    reason?: string,
    notes?: string
): Promise<{ transfer: any; sourceInventory: any }> => {
    // Validate inputs
    if (quantity <= 0) {
        throw new Error("INVALID_QUANTITY: Transfer quantity must be positive");
    }

    if (fromStoreId === toStoreId) {
        throw new Error("SAME_STORE: Source and destination stores must be different");
    }

    // Transaction: Validate + create transfer atomically
    return await prisma.$transaction(async (tx) => {
        // Verify product exists
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) {
            throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
        }

        // Verify both stores exist
        const [fromStore, toStore] = await Promise.all([
            tx.store.findUnique({ where: { id: fromStoreId } }),
            tx.store.findUnique({ where: { id: toStoreId } })
        ]);

        if (!fromStore) {
            throw new Error("SOURCE_STORE_NOT_FOUND: Source store does not exist");
        }
        if (!toStore) {
            throw new Error("DESTINATION_STORE_NOT_FOUND: Destination store does not exist");
        }

        // Check if product is available in source store
        const sourceInventory = await tx.inventory.findUnique({
            where: {
                productId_storeId: {
                    productId,
                    storeId: fromStoreId
                }
            }
        });

        if (!sourceInventory) {
            throw new Error(
                `PRODUCT_NOT_IN_SOURCE: Product ${product.name} is not available in source store ${fromStore.name}`
            );
        }

        // Check sufficient inventory
        if (sourceInventory.quantity < quantity) {
            throw new Error(
                `INSUFFICIENT_INVENTORY: Source store has ${sourceInventory.quantity} units, ` +
                `but ${quantity} requested for transfer`
            );
        }

        // Get or create destination inventory
        let destinationInventory = await tx.inventory.findUnique({
            where: {
                productId_storeId: {
                    productId,
                    storeId: toStoreId
                }
            }
        });

        if (!destinationInventory) {
            // Create destination inventory with zero quantity
            destinationInventory = await tx.inventory.create({
                data: {
                    productId,
                    storeId: toStoreId,
                    quantity: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });
        }

        // Create transfer record
        const transfer = await tx.productTransfer.create({
            data: {
                quantity,
                fromInventoryId: sourceInventory.id,
                toInventoryId: destinationInventory.id,
                productId,
                fromStoreId,
                toStoreId,
                transferredBy: initiatedBy,
                status: TransferStatus.PENDING,
                reason,
                notes,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            include: {
                fromStore: {
                    select: { id: true, name: true }
                },
                toStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                }
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: initiatedBy,
                action: "TRANSFER_INITIATED",
                entityType: "PRODUCT_TRANSFER",
                entityId: transfer.id,
                details: {
                    productId,
                    fromStoreId,
                    toStoreId,
                    quantity,
                    reason
                },
                createdAt: new Date()
            }
        });

        return { transfer, sourceInventory };
    });
};

/**
 * Complete a pending transfer
 * Atomically updates source and destination inventories
 * 
 * @param transferId Transfer ID to complete
 * @param completedBy User ID completing transfer
 */
export const completeTransfer = async (
    transferId: string,
    completedBy: string
): Promise<{
    transfer: any;
    sourceInventory: any;
    destinationInventory: any;
    sourceHistory: any;
    destinationHistory: any;
}> => {
    // Transaction: Update transfer + inventories + histories atomically
    return await prisma.$transaction(async (tx) => {
        // Get transfer with related data
        const transfer = await tx.productTransfer.findUnique({
            where: { id: transferId },
            include: {
                fromInventory: true,
                toInventory: true,
                product: true,
                fromStore: true,
                toStore: true
            }
        });

        if (!transfer) {
            throw new Error("TRANSFER_NOT_FOUND: Transfer does not exist");
        }

        // Validate transfer status
        if (transfer.status !== TransferStatus.PENDING) {
            throw new Error(
                `INVALID_TRANSFER_STATUS: Transfer is ${transfer.status}, must be PENDING to complete`
            );
        }

        // Verify source still has sufficient inventory
        if (transfer.fromInventory.quantity < transfer.quantity) {
            throw new Error(
                `INSUFFICIENT_INVENTORY: Source now has ${transfer.fromInventory.quantity} units, ` +
                `but ${transfer.quantity} requested for transfer`
            );
        }

        // Update source inventory (decrement)
        const updatedSourceInventory = await tx.inventory.update({
            where: { id: transfer.fromInventoryId },
            data: {
                quantity: { decrement: transfer.quantity },
                updatedAt: new Date()
            }
        });

        // Update destination inventory (increment)
        const updatedDestinationInventory = await tx.inventory.update({
            where: { id: transfer.toInventoryId },
            data: {
                quantity: { increment: transfer.quantity },
                updatedAt: new Date()
            }
        });

        // Create inventory history for source
        const sourceHistory = await tx.inventoryHistory.create({
            data: {
                inventoryId: transfer.fromInventoryId,
                changeType: InventoryChangeType.TRANSFER_OUT,
                quantityChange: -transfer.quantity,
                previousQuantity: transfer.fromInventory.quantity,
                newQuantity: updatedSourceInventory.quantity,
                referenceId: transferId,
                referenceType: "TRANSFER",
                notes: `Transfer to ${transfer.toStore.name}`,
                createdBy: completedBy,
                createdAt: new Date()
            }
        });

        // Create inventory history for destination
        const destinationHistory = await tx.inventoryHistory.create({
            data: {
                inventoryId: transfer.toInventoryId,
                changeType: InventoryChangeType.TRANSFER_IN,
                quantityChange: transfer.quantity,
                previousQuantity: transfer.toInventory.quantity,
                newQuantity: updatedDestinationInventory.quantity,
                referenceId: transferId,
                referenceType: "TRANSFER",
                notes: `Transfer from ${transfer.fromStore.name}`,
                createdBy: completedBy,
                createdAt: new Date()
            }
        });

        // Update transfer status
        const updatedTransfer = await tx.productTransfer.update({
            where: { id: transferId },
            data: {
                status: TransferStatus.COMPLETED,
                updatedAt: new Date()
            },
            include: {
                fromStore: {
                    select: { id: true, name: true }
                },
                toStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                }
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: completedBy,
                action: "TRANSFER_COMPLETED",
                entityType: "PRODUCT_TRANSFER",
                entityId: transferId,
                details: {
                    productId: transfer.productId,
                    quantity: transfer.quantity,
                    fromStore: transfer.fromStore.name,
                    toStore: transfer.toStore.name
                },
                createdAt: new Date()
            }
        });

        return {
            transfer: updatedTransfer,
            sourceInventory: updatedSourceInventory,
            destinationInventory: updatedDestinationInventory,
            sourceHistory,
            destinationHistory
        };
    });
};

/**
 * Cancel a pending transfer
 * 
 * @param transferId Transfer ID to cancel
 * @param cancelledBy User ID cancelling transfer
 * @param reason Optional reason for cancellation
 */
export const cancelTransfer = async (
    transferId: string,
    cancelledBy: string,
    reason?: string
): Promise<{ transfer: any }> => {
    // Transaction: Update transfer status + log activity
    return await prisma.$transaction(async (tx) => {
        const transfer = await tx.productTransfer.findUnique({
            where: { id: transferId }
        });

        if (!transfer) {
            throw new Error("TRANSFER_NOT_FOUND: Transfer does not exist");
        }

        // Can only cancel pending transfers
        if (transfer.status !== TransferStatus.PENDING) {
            throw new Error(
                `CANNOT_CANCEL: Transfer is ${transfer.status}, only PENDING transfers can be cancelled`
            );
        }

        // Update transfer status
        const updatedTransfer = await tx.productTransfer.update({
            where: { id: transferId },
            data: {
                status: TransferStatus.CANCELLED,
                reason: reason || transfer.reason,
                updatedAt: new Date()
            },
            include: {
                fromStore: {
                    select: { id: true, name: true }
                },
                toStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                }
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: cancelledBy,
                action: "TRANSFER_CANCELLED",
                entityType: "PRODUCT_TRANSFER",
                entityId: transferId,
                details: { reason },
                createdAt: new Date()
            }
        });

        return { transfer: updatedTransfer };
    });
};

/**
 * Reject a completed transfer (admin only)
 * Reverses inventory changes
 * 
 * @param transferId Transfer ID to reject
 * @param rejectedBy User ID rejecting transfer
 * @param reason Reason for rejection
 */
export const rejectTransfer = async (
    transferId: string,
    rejectedBy: string,
    reason: string
): Promise<{
    transfer: any;
    sourceInventory: any;
    destinationInventory: any;
    sourceHistory: any;
    destinationHistory: any;
}> => {
    if (!reason) {
        throw new Error("REASON_REQUIRED: Reason is required to reject a transfer");
    }

    // Transaction: Reverse inventory + update transfer atomically
    return await prisma.$transaction(async (tx) => {
        const transfer = await tx.productTransfer.findUnique({
            where: { id: transferId },
            include: {
                fromInventory: true,
                toInventory: true
            }
        });

        if (!transfer) {
            throw new Error("TRANSFER_NOT_FOUND: Transfer does not exist");
        }

        // Can only reject completed transfers
        if (transfer.status !== TransferStatus.COMPLETED) {
            throw new Error(
                `CANNOT_REJECT: Transfer is ${transfer.status}, only COMPLETED transfers can be rejected`
            );
        }

        // Verify destination has sufficient inventory to return
        if (transfer.toInventory.quantity < transfer.quantity) {
            throw new Error(
                `INSUFFICIENT_INVENTORY: Destination now has ${transfer.toInventory.quantity} units, ` +
                `cannot return ${transfer.quantity} units`
            );
        }

        // Return inventory to source
        const updatedSourceInventory = await tx.inventory.update({
            where: { id: transfer.fromInventoryId },
            data: {
                quantity: { increment: transfer.quantity },
                updatedAt: new Date()
            }
        });

        // Remove inventory from destination
        const updatedDestinationInventory = await tx.inventory.update({
            where: { id: transfer.toInventoryId },
            data: {
                quantity: { decrement: transfer.quantity },
                updatedAt: new Date()
            }
        });

        // Create inventory history for source (return)
        const sourceHistory = await tx.inventoryHistory.create({
            data: {
                inventoryId: transfer.fromInventoryId,
                changeType: InventoryChangeType.TRANSFER_IN,
                quantityChange: transfer.quantity,
                previousQuantity: transfer.fromInventory.quantity,
                newQuantity: updatedSourceInventory.quantity,
                referenceId: transferId,
                referenceType: "TRANSFER_REJECTION",
                notes: `Transfer rejected: ${reason}`,
                createdBy: rejectedBy,
                createdAt: new Date()
            }
        });

        // Create inventory history for destination (removal)
        const destinationHistory = await tx.inventoryHistory.create({
            data: {
                inventoryId: transfer.toInventoryId,
                changeType: InventoryChangeType.TRANSFER_OUT,
                quantityChange: -transfer.quantity,
                previousQuantity: transfer.toInventory.quantity,
                newQuantity: updatedDestinationInventory.quantity,
                referenceId: transferId,
                referenceType: "TRANSFER_REJECTION",
                notes: `Transfer rejected: ${reason}`,
                createdBy: rejectedBy,
                createdAt: new Date()
            }
        });

        // Update transfer status
        const updatedTransfer = await tx.productTransfer.update({
            where: { id: transferId },
            data: {
                status: TransferStatus.REJECTED,
                reason,
                updatedAt: new Date()
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: rejectedBy,
                action: "TRANSFER_REJECTED",
                entityType: "PRODUCT_TRANSFER",
                entityId: transferId,
                details: { reason },
                createdAt: new Date()
            }
        });

        return {
            transfer: updatedTransfer,
            sourceInventory: updatedSourceInventory,
            destinationInventory: updatedDestinationInventory,
            sourceHistory,
            destinationHistory
        };
    });
};

/**
 * Get transfer details with related data
 * 
 * @param transferId Transfer ID
 */
export const getTransferDetails = async (
    transferId: string
): Promise<any> => {
    const transfer = await prisma.productTransfer.findUnique({
        where: { id: transferId },
        include: {
            fromStore: {
                select: { id: true, name: true, location: true }
            },
            toStore: {
                select: { id: true, name: true, location: true }
            },
            product: {
                select: { id: true, name: true, type: true, grade: true }
            },
            fromInventory: {
                include: {
                    store: {
                        select: { id: true, name: true }
                    }
                }
            },
            toInventory: {
                include: {
                    store: {
                        select: { id: true, name: true }
                    }
                }
            },
            transferredByUser: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true
                }
            }
        }
    });

    if (!transfer) {
        throw new Error("TRANSFER_NOT_FOUND: Transfer does not exist");
    }

    return transfer;
};

/**
 * Get transfers with filters
 * 
 * @param filters Transfer filters
 * @param page Page number
 * @param limit Items per page
 */
export const getTransfers = async (
    filters: {
        status?: TransferStatus;
        productId?: string;
        fromStoreId?: string;
        toStoreId?: string;
        dateFrom?: Date;
        dateTo?: Date;
        initiatedBy?: string;
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    transfers: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.status) {
        whereCondition.status = filters.status;
    }
    if (filters.productId) {
        whereCondition.productId = filters.productId;
    }
    if (filters.fromStoreId) {
        whereCondition.fromStoreId = filters.fromStoreId;
    }
    if (filters.toStoreId) {
        whereCondition.toStoreId = filters.toStoreId;
    }
    if (filters.dateFrom || filters.dateTo) {
        whereCondition.createdAt = {};
        if (filters.dateFrom) whereCondition.createdAt.gte = filters.dateFrom;
        if (filters.dateTo) whereCondition.createdAt.lte = filters.dateTo;
    }
    if (filters.initiatedBy) {
        whereCondition.transferredBy = filters.initiatedBy;
    }

    const [transfers, total] = await Promise.all([
        prisma.productTransfer.findMany({
            where: whereCondition,
            include: {
                fromStore: {
                    select: { id: true, name: true }
                },
                toStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                },
                transferredByUser: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.productTransfer.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        transfers,
        total,
        page,
        totalPages
    };
};

/**
 * Get pending transfers for a store
 * 
 * @param storeId Store ID
 */
export const getPendingTransfersForStore = async (
    storeId: string
): Promise<{
    outgoing: any[];
    incoming: any[];
}> => {
    const [outgoing, incoming] = await Promise.all([
        // Transfers from this store
        prisma.productTransfer.findMany({
            where: {
                fromStoreId: storeId,
                status: TransferStatus.PENDING
            },
            include: {
                toStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        }),
        // Transfers to this store
        prisma.productTransfer.findMany({
            where: {
                toStoreId: storeId,
                status: TransferStatus.PENDING
            },
            include: {
                fromStore: {
                    select: { id: true, name: true }
                },
                product: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        })
    ]);

    return { outgoing, incoming };
};

/**
 * Get transfer statistics
 * 
 * @param storeId Optional store ID for store-specific stats
 * @param dateFrom Optional start date
 * @param dateTo Optional end date
 */
export const getTransferStatistics = async (
    storeId?: string,
    dateFrom?: Date,
    dateTo?: Date
): Promise<{
    totalTransfers: number;
    pendingTransfers: number;
    completedTransfers: number;
    cancelledTransfers: number;
    rejectedTransfers: number;
    totalQuantityTransferred: number;
    topProducts: Array<{ productId: string; productName: string; quantity: number }>;
    topSourceStores: Array<{ storeId: string; storeName: string; quantity: number }>;
    topDestinationStores: Array<{ storeId: string; storeName: string; quantity: number }>;
}> => {
    const whereCondition: any = {};

    if (storeId) {
        whereCondition.OR = [
            { fromStoreId: storeId },
            { toStoreId: storeId }
        ];
    }

    if (dateFrom || dateTo) {
        whereCondition.createdAt = {};
        if (dateFrom) whereCondition.createdAt.gte = dateFrom;
        if (dateTo) whereCondition.createdAt.lte = dateTo;
    }

    const transfers = await prisma.productTransfer.findMany({
        where: whereCondition,
        include: {
            product: {
                select: { id: true, name: true }
            },
            fromStore: {
                select: { id: true, name: true }
            },
            toStore: {
                select: { id: true, name: true }
            }
        }
    });

    // Calculate statistics
    const stats = {
        totalTransfers: transfers.length,
        pendingTransfers: 0,
        completedTransfers: 0,
        cancelledTransfers: 0,
        rejectedTransfers: 0,
        totalQuantityTransferred: 0,
        productMap: new Map<string, { name: string; quantity: number }>(),
        sourceStoreMap: new Map<string, { name: string; quantity: number }>(),
        destinationStoreMap: new Map<string, { name: string; quantity: number }>()
    };

    transfers.forEach(transfer => {
        // Count by status
        switch (transfer.status) {
            case TransferStatus.PENDING:
                stats.pendingTransfers++;
                break;
            case TransferStatus.COMPLETED:
                stats.completedTransfers++;
                stats.totalQuantityTransferred += transfer.quantity;

                // Track product quantities
                const productKey = transfer.productId;
                if (!stats.productMap.has(productKey)) {
                    stats.productMap.set(productKey, {
                        name: transfer.product.name,
                        quantity: 0
                    });
                }
                stats.productMap.get(productKey)!.quantity += transfer.quantity;

                // Track source store quantities
                const sourceKey = transfer.fromStoreId;
                if (!stats.sourceStoreMap.has(sourceKey)) {
                    stats.sourceStoreMap.set(sourceKey, {
                        name: transfer.fromStore.name,
                        quantity: 0
                    });
                }
                stats.sourceStoreMap.get(sourceKey)!.quantity += transfer.quantity;

                // Track destination store quantities
                const destKey = transfer.toStoreId;
                if (!stats.destinationStoreMap.has(destKey)) {
                    stats.destinationStoreMap.set(destKey, {
                        name: transfer.toStore.name,
                        quantity: 0
                    });
                }
                stats.destinationStoreMap.get(destKey)!.quantity += transfer.quantity;
                break;
            case TransferStatus.CANCELLED:
                stats.cancelledTransfers++;
                break;
            case TransferStatus.REJECTED:
                stats.rejectedTransfers++;
                break;
        }
    });

    // Sort and get top 10 products
    const sortProducts = (map: Map<string, { name: string; quantity: number }>) => {
        return Array.from(map.entries())
            .map(([id, data]) => ({
                productId: id,
                productName: data.name,
                quantity: data.quantity
            }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10);
    };

    // Sort and get top 10 stores
    const sortStores = (map: Map<string, { name: string; quantity: number }>) => {
        return Array.from(map.entries())
            .map(([id, data]) => ({
                storeId: id,
                storeName: data.name,
                quantity: data.quantity
            }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10);
    };

    return {
        totalTransfers: stats.totalTransfers,
        pendingTransfers: stats.pendingTransfers,
        completedTransfers: stats.completedTransfers,
        cancelledTransfers: stats.cancelledTransfers,
        rejectedTransfers: stats.rejectedTransfers,
        totalQuantityTransferred: stats.totalQuantityTransferred,
        topProducts: sortProducts(stats.productMap),
        topSourceStores: sortStores(stats.sourceStoreMap),
        topDestinationStores: sortStores(stats.destinationStoreMap)
    };
};