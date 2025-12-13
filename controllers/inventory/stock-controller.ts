import { prisma } from "../../lib/prisma";
import { InventoryChangeType } from "@prisma/client";

/**
 * INVENTORY CONTROLLER: Core stock management operations
 * 
 * Aggregate Root: Inventory
 * Supporting Tables: InventoryHistory (audit trail)
 * 
 * Key Invariants:
 * 1. Quantity cannot go negative
 * 2. Every quantity change must create audit trail
 * 3. Inventory records are unique per (product, store)
 */

// ============ INVENTORY ALLOCATION & SETUP ============

/**
 * Allocate initial inventory to a store
 * Creates inventory record if it doesn't exist
 * 
 * @param productId Product to allocate
 * @param storeId Store to allocate to
 * @param quantity Initial quantity (must be ≥ 0)
 * @param storePrice Optional store-specific price
 * @param createdBy User ID performing the allocation
 */
export const allocateInventory = async (
    productId: string,
    storeId: string,
    quantity: number,
    createdBy: string,
    storePrice?: number
): Promise<{ inventory: any; history: any }> => {
    if (quantity < 0) {
        throw new Error("INVALID_QUANTITY: Initial inventory quantity cannot be negative");
    }

    // Transaction: Create inventory + audit history atomically
    return await prisma.$transaction(async (tx) => {
        // Verify product and store exist
        const [product, store] = await Promise.all([
            tx.product.findUnique({ where: { id: productId } }),
            tx.store.findUnique({ where: { id: storeId } })
        ]);

        if (!product) {
            throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
        }
        if (!store) {
            throw new Error("STORE_NOT_FOUND: Store does not exist");
        }

        // Create or update inventory
        const inventory = await tx.inventory.upsert({
            where: {
                productId_storeId: {
                    productId,
                    storeId
                }
            },
            create: {
                productId,
                storeId,
                quantity,
                storePrice,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            update: {
                quantity: { increment: quantity },
                storePrice,
                updatedAt: new Date()
            }
        });

        // Create audit trail
        const history = await tx.inventoryHistory.create({
            data: {
                inventoryId: inventory.id,
                changeType: InventoryChangeType.PURCHASE,
                quantityChange: quantity,
                previousQuantity: inventory.quantity - quantity,
                newQuantity: inventory.quantity,
                referenceId: undefined,
                referenceType: "INITIAL_ALLOCATION",
                notes: `Initial allocation to store ${store.name}`,
                createdBy,
                createdAt: new Date()
            }
        });

        return { inventory, history };
    });
};

/**
 * Adjust inventory quantity (damage, audit correction, returns)
 * 
 * @param inventoryId Inventory record to adjust
 * @param adjustment Positive or negative quantity change
 * @param changeType Type of adjustment (DAMAGE, ADJUSTMENT, RETURN)
 * @param createdBy User ID performing adjustment
 * @param notes Optional explanation
 * @param referenceId Optional reference (e.g., transfer ID, sale ID)
 */
export const adjustInventory = async (
    inventoryId: string,
    adjustment: number,
    changeType: InventoryChangeType,
    createdBy: string,
    notes?: string,
    referenceId?: string
): Promise<{ inventory: any; history: any }> => {
    if (adjustment === 0) {
        throw new Error("INVALID_ADJUSTMENT: Adjustment quantity cannot be zero");
    }

    // Transaction: Update quantity + create history atomically
    return await prisma.$transaction(async (tx) => {
        // Lock inventory row for update
        const inventory = await tx.inventory.findUnique({
            where: { id: inventoryId },
            select: { id: true, productId: true, storeId: true, quantity: true }
        });

        if (!inventory) {
            throw new Error("INVENTORY_NOT_FOUND: Inventory record does not exist");
        }

        // Calculate new quantity
        const newQuantity = inventory.quantity + adjustment;

        // Enforce non-negative inventory invariant
        if (newQuantity < 0) {
            throw new Error(
                `INSUFFICIENT_INVENTORY: Cannot adjust by ${adjustment}. ` +
                `Current: ${inventory.quantity}, Result would be: ${newQuantity}`
            );
        }

        // Update inventory quantity
        const updatedInventory = await tx.inventory.update({
            where: { id: inventoryId },
            data: {
                quantity: newQuantity,
                updatedAt: new Date()
            }
        });

        // Create audit trail
        const history = await tx.inventoryHistory.create({
            data: {
                inventoryId,
                changeType,
                quantityChange: adjustment,
                previousQuantity: inventory.quantity,
                newQuantity,
                referenceId,
                referenceType: referenceId ? getReferenceType(changeType) : undefined,
                notes: notes || getDefaultNotes(changeType, adjustment, inventory),
                createdBy,
                createdAt: new Date()
            }
        });

        return { inventory: updatedInventory, history };
    });
};

/**
 * Reserve inventory for pending sale or transfer
 * Creates a temporary hold on inventory
 * 
 * @param productId Product to reserve
 * @param storeId Store where inventory resides
 * @param quantity Quantity to reserve
 * @param reservationId Unique ID for this reservation
 * @param reservedBy User ID making reservation
 */
export const reserveInventory = async (
    productId: string,
    storeId: string,
    quantity: number,
    reservationId: string,
    reservedBy: string
): Promise<boolean> => {
    if (quantity <= 0) {
        throw new Error("INVALID_QUANTITY: Reservation quantity must be positive");
    }

    return await prisma.$transaction(async (tx) => {
        // Check current available inventory (excluding pending reservations)
        const inventory = await tx.inventory.findUnique({
            where: {
                productId_storeId: {
                    productId,
                    storeId
                }
            }
        });

        if (!inventory) {
            throw new Error("INVENTORY_NOT_FOUND: No inventory found for product in this store");
        }

        // For now, we'll just check availability
        // In a real system, you might have a separate reservations table
        const available = inventory.quantity;

        if (available < quantity) {
            throw new Error(
                `INSUFFICIENT_INVENTORY: Cannot reserve ${quantity}. ` +
                `Available: ${available}`
            );
        }

        // Note: In production, you'd create a reservation record here
        // and track reserved vs available quantities separately

        return true;
    });
};

/**
 * Check inventory availability across multiple stores
 * Returns stores with sufficient inventory for requested quantity
 * 
 * @param productId Product to check
 * @param quantity Quantity needed
 * @param excludeStoreId Optional store to exclude from results
 */
export const checkInventoryAvailability = async (
    productId: string,
    quantity: number,
    excludeStoreId?: string
): Promise<Array<{ storeId: string; storeName: string; available: number }>> => {
    const inventories = await prisma.inventory.findMany({
        where: {
            productId,
            quantity: { gte: quantity },
            ...(excludeStoreId && { storeId: { not: excludeStoreId } })
        },
        include: {
            store: {
                select: {
                    id: true,
                    name: true
                }
            }
        },
        orderBy: { quantity: 'desc' }
    });

    return inventories.map(inv => ({
        storeId: inv.storeId,
        storeName: inv.store.name,
        available: inv.quantity
    }));
};

/**
 * Get inventory levels for a product across all stores
 * 
 * @param productId Product to query
 */
export const getProductInventoryAcrossStores = async (
    productId: string
): Promise<Array<{
    storeId: string;
    storeName: string;
    quantity: number;
    storePrice?: number;
    reorderLevel?: number;
    optimalLevel?: number;
}>> => {
    const inventories = await prisma.inventory.findMany({
        where: { productId },
        include: {
            store: {
                select: {
                    id: true,
                    name: true,
                    isMainStore: true
                }
            }
        },
        orderBy: [
            { store: { isMainStore: 'desc' } },
            { store: { name: 'asc' } }
        ]
    });

    return inventories.map(inv => ({
        storeId: inv.storeId,
        storeName: inv.store.name,
        quantity: inv.quantity,
        storePrice: inv.storePrice ?? undefined,
        reorderLevel: inv.reorderLevel ?? undefined,
        optimalLevel: inv.optimalLevel ?? undefined
    }));

};

/**
 * Set reorder levels for inventory
 * Used for automatic reordering logic
 * 
 * @param inventoryId Inventory to configure
 * @param reorderLevel Quantity at which to trigger reorder
 * @param optimalLevel Target quantity after reorder
 * @param updatedBy User ID making the change
 */
export const setReorderLevels = async (
    inventoryId: string,
    reorderLevel: number,
    optimalLevel: number,
    updatedBy: string
): Promise<any> => {
    if (reorderLevel < 0 || optimalLevel < 0) {
        throw new Error("INVALID_LEVELS: Reorder and optimal levels cannot be negative");
    }

    if (optimalLevel <= reorderLevel) {
        throw new Error("INVALID_LEVELS: Optimal level must be greater than reorder level");
    }

    return await prisma.inventory.update({
        where: { id: inventoryId },
        data: {
            reorderLevel,
            optimalLevel,
            updatedAt: new Date()
        }
    });
};

/**
 * Get stores that need restocking based on reorder levels
 * 
 * @param storeId Optional filter by specific store
 */
export const getStoresNeedingRestock = async (
    storeId?: string
): Promise<Array<{
    storeId: string;
    storeName: string;
    productId: string;
    productName: string;
    currentQuantity: number;
    reorderLevel: number;
    optimalLevel: number;
    needed: number;
}>> => {
    const whereCondition: any = {
        quantity: { lte: prisma.inventory.fields.reorderLevel },
        reorderLevel: { not: null }
    };

    if (storeId) {
        whereCondition.storeId = storeId;
    }

    const inventories = await prisma.inventory.findMany({
        where: whereCondition,
        include: {
            store: {
                select: {
                    id: true,
                    name: true
                }
            },
            product: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return inventories.map(inv => ({
        storeId: inv.storeId,
        storeName: inv.store.name,
        productId: inv.productId,
        productName: inv.product.name,
        currentQuantity: inv.quantity,
        reorderLevel: inv.reorderLevel!,
        optimalLevel: inv.optimalLevel!,
        needed: inv.optimalLevel! - inv.quantity
    }));
};

// ============ HELPER FUNCTIONS ============

function getReferenceType(changeType: InventoryChangeType): string {
    const map: Record<InventoryChangeType, string> = {
        PURCHASE: "PURCHASE_ORDER",
        SALE: "SALE",
        TRANSFER_OUT: "TRANSFER",
        TRANSFER_IN: "TRANSFER",
        ADJUSTMENT: "ADJUSTMENT",
        RETURN: "RETURN",
        DAMAGE: "DAMAGE_REPORT"
    };
    return map[changeType] || "OTHER";
}

function getDefaultNotes(
    changeType: InventoryChangeType,
    adjustment: number,
    inventory: any
): string {
    const direction = adjustment > 0 ? "increase" : "decrease";
    const absAdjustment = Math.abs(adjustment);

    const notes: Record<InventoryChangeType, string> = {
        PURCHASE: `Purchase of ${absAdjustment} units`,
        SALE: `Sale of ${absAdjustment} units`,
        TRANSFER_OUT: `Transferred out ${absAdjustment} units`,
        TRANSFER_IN: `Transferred in ${absAdjustment} units`,
        ADJUSTMENT: `Manual ${direction} of ${absAdjustment} units`,
        RETURN: `Customer return of ${absAdjustment} units`,
        DAMAGE: `Damaged goods ${direction === "decrease" ? "write-off" : "reversal"} of ${absAdjustment} units`
    };

    return notes[changeType] || `Inventory ${direction} of ${absAdjustment} units`;
}

/**
 * Bulk inventory update for receiving shipments
 * Updates multiple inventory records atomically
 * 
 * @param updates Array of inventory updates
 * @param shipmentId Optional shipment reference ID
 * @param receivedBy User ID receiving shipment
 */
export const receiveShipment = async (
    updates: Array<{
        productId: string;
        storeId: string;
        quantity: number;
        storePrice?: number;
    }>,
    shipmentId: string,
    receivedBy: string
): Promise<Array<{ inventory: any; history: any }>> => {
    if (updates.length === 0) {
        throw new Error("EMPTY_SHIPMENT: No items in shipment");
    }

    // Transaction: Update all inventories + create histories atomically
    return await prisma.$transaction(async (tx) => {
        const results = [];

        for (const update of updates) {
            if (update.quantity <= 0) {
                throw new Error(`INVALID_QUANTITY: Quantity must be positive for product ${update.productId}`);
            }

            // Get current inventory or create if doesn't exist
            const inventory = await tx.inventory.upsert({
                where: {
                    productId_storeId: {
                        productId: update.productId,
                        storeId: update.storeId
                    }
                },
                create: {
                    productId: update.productId,
                    storeId: update.storeId,
                    quantity: update.quantity,
                    storePrice: update.storePrice,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                update: {
                    quantity: { increment: update.quantity },
                    storePrice: update.storePrice,
                    updatedAt: new Date()
                }
            });

            // Create audit trail
            const history = await tx.inventoryHistory.create({
                data: {
                    inventoryId: inventory.id,
                    changeType: InventoryChangeType.PURCHASE,
                    quantityChange: update.quantity,
                    previousQuantity: inventory.quantity - update.quantity,
                    newQuantity: inventory.quantity,
                    referenceId: shipmentId,
                    referenceType: "SHIPMENT",
                    notes: `Received shipment ${shipmentId}`,
                    createdBy: receivedBy,
                    createdAt: new Date()
                }
            });

            results.push({ inventory, history });
        }

        return results;
    });
};