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

export const getInventory = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 20,
            sortBy,
            sortOrder,
            search,
            storeId,
            productId,
            minQuantity,
            maxQuantity,
            belowReorder,
            type,
            grade
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        const filterBuilder = new FilterBuilder()
            .where(search as string, ['product.name', 'product.tireSize'])
            .store(storeId as string)
            .product(productId as string)
            .inventoryFilters({
                minQuantity: minQuantity ? Number(minQuantity) : undefined,
                maxQuantity: maxQuantity ? Number(maxQuantity) : undefined,
                belowReorder: belowReorder === 'true',
                type: type as string,
                grade: grade as string
            })
            .includeProduct()
            .includeStore()
            .order(sortBy as string, sortOrder as 'asc' | 'desc');

        const filters = filterBuilder.build();

        // Extract where, orderBy, and include from filters
        const whereClause = filters.where || {};
        const orderByClause = filters.orderBy || { createdAt: 'desc' };
        const includeClause = {
            product: true,
            store: {
                select: {
                    id: true,
                    name: true,
                    isMainStore: true,
                    city: true,
                    address: true
                }
            }
        };

        const [inventory, total] = await Promise.all([
            prisma.inventory.findMany({
                where: whereClause,
                skip,
                take,
                orderBy: orderByClause,
                include: includeClause
            }),
            prisma.inventory.count({ where: whereClause })
        ]);

        // Calculate inventory value for each item
        const inventoryWithValue = inventory.map(item => {
            const price = item.storePrice || (item.product?.basePrice || 0);
            return {
                ...item,
                value: item.quantity * price
            };
        });

        // Calculate summary metrics
        const summary = calculateInventoryMetrics(inventoryWithValue);

        res.json({
            data: inventoryWithValue,
            summary,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get inventory error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getInventoryById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const inventoryId = Array.isArray(id) ? id[0] : id;

        const inventory = await prisma.inventory.findUnique({
            where: { id: inventoryId },
            include: {
                product: true,
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true,
                        city: true,
                        address: true,
                        phone: true,
                        email: true
                    }
                },
                histories: {
                    orderBy: { createdAt: 'desc' },
                    take: 20,
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });

        if (!inventory) {
            res.status(404).json({ error: "Inventory item not found" });
            return;
        }

        res.json(inventory);
    } catch (error) {
        console.error("Get inventory item error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const updateInventory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const inventoryId = Array.isArray(id) ? id[0] : id;
        const { quantity, reorderLevel, optimalLevel, storePrice } = req.body;

        const inventory = await prisma.inventory.findUnique({
            where: { id: inventoryId },
            include: {
                product: true,
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true
                    }
                }
            }
        });

        if (!inventory) {
            res.status(404).json({ error: "Inventory item not found" });
            return;
        }

        const previousQuantity = inventory.quantity;
        const newQuantity = quantity !== undefined ? Number(quantity) : inventory.quantity;

        // Update inventory
        const updatedInventory = await prisma.inventory.update({
            where: { id: inventoryId },
            data: {
                ...(quantity !== undefined && { quantity: newQuantity }),
                ...(reorderLevel !== undefined && { reorderLevel: Number(reorderLevel) }),
                ...(optimalLevel !== undefined && { optimalLevel: Number(optimalLevel) }),
                ...(storePrice !== undefined && { storePrice: storePrice ? Number(storePrice) : null })
            }
        });

        // Create inventory history if quantity changed
        if (quantity !== undefined && previousQuantity !== newQuantity) {
            const quantityChange = newQuantity - previousQuantity;
            const changeType = quantityChange > 0 ? 'ADJUSTMENT' : 'ADJUSTMENT';

            await prisma.inventoryHistory.create({
                data: {
                    inventoryId: inventoryId,
                    changeType,
                    quantityChange,
                    previousQuantity,
                    newQuantity,
                    createdBy: req.user!.id,
                    notes: `Manual inventory adjustment for ${inventory.store?.name || 'store'}`
                }
            });
        }

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'INVENTORY_UPDATED',
                    entityType: 'INVENTORY',
                    entityId: inventoryId,
                    details: {
                        previousQuantity,
                        newQuantity,
                        storeName: inventory.store?.name,
                        updatedFields: Object.keys(req.body)
                    }
                }
            });
        }

        res.json(updatedInventory);
    } catch (error) {
        console.error("Update inventory error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getLowStockItems = async (req: Request, res: Response): Promise<void> => {
    try {
        const { storeId } = req.query;

        const where: any = {
            quantity: { lt: prisma.inventory.fields.reorderLevel }
        };

        if (storeId) where.storeId = storeId;

        const lowStockItems = await prisma.inventory.findMany({
            where,
            include: {
                product: true,
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true,
                        city: true
                    }
                }
            },
            orderBy: {
                quantity: 'asc'
            },
            take: 50
        });

        // Group by store
        const groupedByStore = lowStockItems.reduce((acc, item) => {
            const storeName = item.store?.name || 'Unknown';
            if (!acc[storeName]) {
                acc[storeName] = {
                    store: item.store,
                    items: []
                };
            }
            acc[storeName].items.push(item);
            return acc;
        }, {} as Record<string, any>);

        // Calculate totals
        const totals = Object.keys(groupedByStore).reduce((acc, storeName) => {
            const store = groupedByStore[storeName];
            acc[storeName] = {
                totalItems: store.items.length,
                totalValue: store.items.reduce((sum: number, item: any) => {
                    const price = item.storePrice || (item.product?.basePrice || 0);
                    return sum + (item.quantity * price);
                }, 0)
            };
            return acc;
        }, {} as Record<string, any>);

        res.json({
            total: lowStockItems.length,
            groupedByStore,
            totals,
            items: lowStockItems
        });
    } catch (error) {
        console.error("Get low stock items error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getInventoryHistory = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 20,
            inventoryId,
            storeId,
            productId,
            changeType,
            startDate,
            endDate
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        const where: any = {};

        if (inventoryId) where.inventoryId = inventoryId;
        if (changeType) where.changeType = changeType;

        // Date range filter
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate as string);
            if (endDate) where.createdAt.lte = new Date(endDate as string);
        }

        // Filter by store or product through inventory
        if (storeId || productId) {
            where.inventory = {};
            if (storeId) where.inventory.storeId = storeId;
            if (productId) where.inventory.productId = productId;
        }

        const [history, total] = await Promise.all([
            prisma.inventoryHistory.findMany({
                where,
                skip,
                take,
                include: {
                    inventory: {
                        include: {
                            product: true,
                            store: {
                                select: {
                                    id: true,
                                    name: true,
                                    isMainStore: true
                                }
                            }
                        }
                    },
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.inventoryHistory.count({ where })
        ]);

        // Calculate summary
        const summary = {
            totalQuantityChange: history.reduce((sum, item) => sum + item.quantityChange, 0),
            increases: history.filter(item => item.quantityChange > 0).length,
            decreases: history.filter(item => item.quantityChange < 0).length,
            adjustments: history.filter(item => item.changeType === 'ADJUSTMENT').length
        };

        res.json({
            data: history,
            summary,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get inventory history error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const bulkInventoryUpdate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { updates } = req.body; // Array of { inventoryId, quantity, notes }

        if (!Array.isArray(updates) || updates.length === 0) {
            res.status(400).json({ error: "Updates array is required" });
            return;
        }

        const results = await prisma.$transaction(async (tx) => {
            const results = [];

            for (const update of updates) {
                const { inventoryId, quantity, notes } = update;

                const inventory = await tx.inventory.findUnique({
                    where: { id: inventoryId },
                    include: {
                        product: true,
                        store: {
                            select: {
                                id: true,
                                name: true,
                                isMainStore: true
                            }
                        }
                    }
                });

                if (!inventory) continue;

                const previousQuantity = inventory.quantity;
                const newQuantity = Number(quantity);
                const quantityChange = newQuantity - previousQuantity;

                // Update inventory
                const updatedInventory = await tx.inventory.update({
                    where: { id: inventoryId },
                    data: { quantity: newQuantity }
                });

                // Create history
                await tx.inventoryHistory.create({
                    data: {
                        inventoryId,
                        changeType: 'ADJUSTMENT',
                        quantityChange,
                        previousQuantity,
                        newQuantity,
                        createdBy: req.user!.id,
                        notes: notes || `Bulk inventory update for ${inventory.store?.name || 'store'}`
                    }
                });

                results.push({
                    inventoryId,
                    previousQuantity,
                    newQuantity,
                    quantityChange,
                    store: inventory.store?.name || 'Unknown',
                    storeType: inventory.store?.isMainStore ? 'Main Store' : 'Branch Store',
                    product: inventory.product?.name || 'Unknown'
                });
            }

            return results;
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'BULK_INVENTORY_UPDATE',
                    entityType: 'INVENTORY',
                    entityId: 'multiple',
                    details: { count: updates.length, results }
                }
            });
        }

        res.json({
            message: `${updates.length} inventory items updated successfully`,
            results
        });
    } catch (error) {
        console.error("Bulk inventory update error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getInventoryReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { storeId, productType, grade, export: exportFormat } = req.query;

        const where: any = {};

        if (storeId) where.storeId = storeId;
        if (productType) where.product = { type: productType };
        if (grade) where.product = { ...where.product, grade };

        const inventory = await prisma.inventory.findMany({
            where,
            include: {
                product: true,
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true,
                        city: true
                    }
                }
            },
            orderBy: [
                { storeId: 'asc' },
                { product: { name: 'asc' } }
            ]
        });

        // Calculate metrics with type safety
        const totalValue = inventory.reduce((sum, item) => {
            const price = item.storePrice || (item.product?.basePrice || 0);
            return sum + (item.quantity * price);
        }, 0);

        const totalItems = inventory.reduce((sum, item) => sum + item.quantity, 0);

        const lowStockCount = inventory.filter(item =>
            item.quantity < (item.reorderLevel || 10)).length;

        // Separate main store and branch stores
        const mainStoreItems = inventory.filter(item => item.store?.isMainStore);
        const branchStoreItems = inventory.filter(item => !item.store?.isMainStore);

        // Group by store
        const byStore = inventory.reduce((acc, item) => {
            const storeName = item.store?.name || 'Unknown Store';
            if (!acc[storeName]) {
                acc[storeName] = {
                    store: item.store,
                    items: [],
                    totalValue: 0,
                    totalItems: 0,
                    storeType: item.store?.isMainStore ? 'Main Store' : 'Branch Store'
                };
            }
            const price = item.storePrice || (item.product?.basePrice || 0);
            acc[storeName].items.push(item);
            acc[storeName].totalValue += item.quantity * price;
            acc[storeName].totalItems += item.quantity;
            return acc;
        }, {} as Record<string, any>);

        // Group by product type
        const byType = inventory.reduce((acc, item) => {
            const type = item.product?.type || 'Unknown';
            if (!acc[type]) {
                acc[type] = {
                    type,
                    count: 0,
                    totalValue: 0,
                    totalItems: 0
                };
            }
            const price = item.storePrice || (item.product?.basePrice || 0);
            acc[type].count++;
            acc[type].totalValue += item.quantity * price;
            acc[type].totalItems += item.quantity;
            return acc;
        }, {} as Record<string, any>);

        const report = {
            summary: {
                totalItems,
                totalValue,
                averageItemValue: totalItems > 0 ? totalValue / totalItems : 0,
                lowStockCount,
                storeCount: Object.keys(byStore).length,
                uniqueProducts: new Set(inventory.map(item => item.productId)).size,
                mainStoreItems: mainStoreItems.length,
                branchStoreItems: branchStoreItems.length,
                mainStoreTotalValue: mainStoreItems.reduce((sum, item) => {
                    const price = item.storePrice || (item.product?.basePrice || 0);
                    return sum + (item.quantity * price);
                }, 0),
                branchStoreTotalValue: branchStoreItems.reduce((sum, item) => {
                    const price = item.storePrice || (item.product?.basePrice || 0);
                    return sum + (item.quantity * price);
                }, 0)
            },
            byStore,
            byType,
            timestamp: new Date(),
            generatedBy: req.user?.id
        };

        // Export if requested
        if (exportFormat === 'csv') {
            // Simple CSV export
            const csv = [
                ['Store', 'Store Type', 'Product', 'Type', 'Quantity', 'Store Price', 'Base Price', 'Value', 'Reorder Level', 'Status'].join(','),
                ...inventory.map(item => {
                    const storePrice = item.storePrice || '';
                    const basePrice = item.product?.basePrice || 0;
                    const price = item.storePrice || basePrice;
                    const value = item.quantity * price;
                    const status = item.quantity < (item.reorderLevel || 10) ? 'LOW_STOCK' : 'OK';

                    return [
                        item.store?.name || 'Unknown',
                        item.store?.isMainStore ? 'Main Store' : 'Branch Store',
                        item.product?.name || 'Unknown',
                        item.product?.type || 'Unknown',
                        item.quantity,
                        storePrice,
                        basePrice,
                        value,
                        item.reorderLevel || '',
                        status
                    ].join(',');
                })
            ].join('\n');

            res.header('Content-Type', 'text/csv');
            res.attachment('inventory_report.csv');
            res.send(csv);
            return;
        }

        res.json(report);
    } catch (error) {
        console.error("Get inventory report error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getMainStoreInventory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const { skip, take } = generatePagination(Number(page), Number(limit));

        // Find main store
        const mainStore = await prisma.store.findFirst({
            where: { isMainStore: true }
        });

        if (!mainStore) {
            res.status(404).json({ error: "Main store not found" });
            return;
        }

        const where: any = {
            storeId: mainStore.id
        };

        if (search) {
            where.product = {
                OR: [
                    { name: { contains: search as string, mode: 'insensitive' } },
                    { tireSize: { contains: search as string, mode: 'insensitive' } },
                    { commodity: { contains: search as string, mode: 'insensitive' } }
                ]
            };
        }

        const [inventory, total] = await Promise.all([
            prisma.inventory.findMany({
                where,
                skip,
                take,
                include: {
                    product: true,
                    store: {
                        select: {
                            id: true,
                            name: true,
                            isMainStore: true
                        }
                    }
                },
                orderBy: { product: { name: 'asc' } }
            }),
            prisma.inventory.count({ where })
        ]);

        // Calculate total value
        const totalValue = inventory.reduce((sum, item) => {
            const price = item.storePrice || (item.product?.basePrice || 0);
            return sum + (item.quantity * price);
        }, 0);

        // Count low stock items
        const lowStockCount = inventory.filter(item =>
            item.quantity < (item.reorderLevel || 10)
        ).length;

        res.json({
            data: inventory,
            summary: {
                totalItems: total,
                totalValue,
                lowStockCount,
                averageValue: total > 0 ? totalValue / total : 0
            },
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get main store inventory error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSuggestedTransfers = async (req: Request, res: Response) => {
    try {
        const { threshold = 0.7 } = req.query; // 70% threshold for auto-suggestion

        // Get main store
        const mainStore = await prisma.store.findFirst({
            where: { isMainStore: true }
        });

        if (!mainStore) {
            res.status(404).json({ error: "Main store not found" });
            return;
        }

        // Find branch stores with low stock
        const suggestions = await prisma.inventory.findMany({
            where: {
                store: { isMainStore: false },
                quantity: { lt: prisma.inventory.fields.reorderLevel }
            },
            include: {
                product: true,
                store: true
            }
        });

        // Check main store availability and create suggestions
        const transferSuggestions = [];

        for (const item of suggestions) {
            const mainStoreInventory = await prisma.inventory.findUnique({
                where: {
                    productId_storeId: {
                        productId: item.productId,
                        storeId: mainStore.id
                    }
                }
            });

            if (mainStoreInventory && mainStoreInventory.quantity > 0) {
                const reorderLevel = item.reorderLevel || 10;
                const optimalLevel = item.optimalLevel || 50;
                const needed = optimalLevel - item.quantity;
                const maxTransfer = Math.min(needed, mainStoreInventory.quantity);

                if (maxTransfer > 0) {
                    transferSuggestions.push({
                        fromStoreId: mainStore.id,
                        fromStoreName: mainStore.name,
                        toStoreId: item.storeId,
                        toStoreName: item.store.name,
                        productId: item.productId,
                        productName: item.product.name,
                        currentQuantity: item.quantity,
                        reorderLevel,
                        optimalLevel,
                        neededQuantity: needed,
                        availableInMainStore: mainStoreInventory.quantity,
                        suggestedQuantity: Math.floor(maxTransfer * parseFloat(threshold as string)),
                        priority: needed / optimalLevel // Higher priority for lower stock
                    });
                }
            }
        }

        // Sort by priority (most needed first)
        transferSuggestions.sort((a, b) => b.priority - a.priority);

        res.json({
            suggestions: transferSuggestions,
            summary: {
                totalSuggestions: transferSuggestions.length,
                totalProducts: new Set(transferSuggestions.map(s => s.productId)).size,
                totalStores: new Set(transferSuggestions.map(s => s.toStoreId)).size,
                estimatedTotalTransfer: transferSuggestions.reduce((sum, s) => sum + s.suggestedQuantity, 0)
            }
        });
    } catch (error) {
        console.error("Get suggested transfers error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};