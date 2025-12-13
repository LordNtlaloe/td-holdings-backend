import { prisma } from "../../lib/prisma";
import { ProductType, ProductGrade, TireCategory, TireUsage } from "@prisma/client";

/**
 * CATALOG PRODUCT CONTROLLER: Product master data management
 * 
 * Aggregate Root: Product
 * Supporting: StoreProduct (availability tracking)
 * 
 * Key Invariants:
 * 1. Product name must be unique
 * 2. Product cannot be deleted if has inventory or sales
 * 3. Price and quantity must be non-negative
 * 4. Product type determines which fields are required
 */

// ============ PRODUCT CREATION & MANAGEMENT ============

/**
 * Create a new product in the catalog
 * Can optionally assign to stores with initial quantities
 * 
 * @param name Product name (must be unique)
 * @param basePrice Base price for the product
 * @param type Product type (TIRE, BALE)
 * @param grade Product grade (A, B, C)
 * @param commodity Optional commodity type
 * @param tireSpecific Optional tire-specific fields
 * @param baleSpecific Optional bale-specific fields
 * @param storeAssignments Optional initial store assignments
 */
export const createProduct = async (
    name: string,
    basePrice: number,
    type: ProductType,
    grade: ProductGrade,
    createdBy: string,
    commodity?: string,
    tireSpecific?: {
        tireCategory?: TireCategory;
        tireUsage?: TireUsage;
        tireSize?: string;
        loadIndex?: string;
        speedRating?: string;
        warrantyPeriod?: string;
    },
    baleSpecific?: {
        baleWeight?: number;
        baleCategory?: string;
        originCountry?: string;
        importDate?: Date;
    },
    storeAssignments?: Array<{
        storeId: string;
        initialQuantity?: number;
        storePrice?: number;
    }>,
): Promise<{ product: any; storeAssignments: any[] }> => {
    // Validate required fields
    if (!name || basePrice == null || !type || !grade) {
        throw new Error("MISSING_REQUIRED_FIELDS: Name, basePrice, type, and grade are required");
    }

    if (basePrice < 0) {
        throw new Error("INVALID_PRICE: Base price cannot be negative");
    }

    // Validate type-specific fields
    if (type === ProductType.TIRE) {
        // Check if bale-specific fields are being used for a TIRE
        if (baleSpecific?.baleWeight || baleSpecific?.baleCategory) {
            throw new Error("INVALID_FIELD: Bale-specific fields are not valid for TIRE type");
        }
    } else if (type === ProductType.BALE) {
        // Check if tire-specific fields are being used for a BALE
        if (tireSpecific?.tireCategory || tireSpecific?.tireUsage) {
            throw new Error("INVALID_FIELD: Tire-specific fields are not valid for BALE type");
        }
    }
    // Transaction: Create product + store assignments atomically
    return await prisma.$transaction(async (tx) => {
        // Check if product name already exists
        const existingProduct = await tx.product.findUnique({ where: { name } });
        if (existingProduct) {
            throw new Error("PRODUCT_EXISTS: A product with this name already exists");
        }

        // Create the product
        const product = await tx.product.create({
            data: {
                name,
                basePrice,
                type,
                grade,
                commodity,
                // Tire-specific fields
                tireCategory: tireSpecific?.tireCategory,
                tireUsage: tireSpecific?.tireUsage,
                tireSize: tireSpecific?.tireSize,
                loadIndex: tireSpecific?.loadIndex,
                speedRating: tireSpecific?.speedRating,
                warrantyPeriod: tireSpecific?.warrantyPeriod,
                // Bale-specific fields
                baleWeight: baleSpecific?.baleWeight,
                baleCategory: baleSpecific?.baleCategory,
                originCountry: baleSpecific?.originCountry,
                importDate: baleSpecific?.importDate,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });

        const assignments = [];

        // Create store assignments if provided
        if (storeAssignments && storeAssignments.length > 0) {
            for (const assignment of storeAssignments) {
                // Verify store exists
                const store = await tx.store.findUnique({
                    where: { id: assignment.storeId }
                });
                if (!store) {
                    throw new Error(`STORE_NOT_FOUND: Store ${assignment.storeId} does not exist`);
                }

                // Create StoreProduct record
                const storeProduct = await tx.storeProduct.create({
                    data: {
                        productId: product.id,
                        storeId: assignment.storeId,
                        createdAt: new Date()
                    }
                });

                // Create initial inventory if quantity provided
                if (assignment.initialQuantity && assignment.initialQuantity > 0) {
                    await tx.inventory.create({
                        data: {
                            productId: product.id,
                            storeId: assignment.storeId,
                            quantity: assignment.initialQuantity,
                            storePrice: assignment.storePrice,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    });

                    // Create inventory history
                    await tx.inventoryHistory.create({
                        data: {
                            inventoryId: (await tx.inventory.findUnique({
                                where: {
                                    productId_storeId: {
                                        productId: product.id,
                                        storeId: assignment.storeId
                                    }
                                }
                            }))!.id,
                            changeType: "PURCHASE",
                            quantityChange: assignment.initialQuantity,
                            previousQuantity: 0,
                            newQuantity: assignment.initialQuantity,
                            referenceType: "PRODUCT_CREATION",
                            notes: `Initial stock for new product ${product.name}`,
                            createdBy,
                            createdAt: new Date()
                        }
                    });
                }

                assignments.push({
                    storeProduct,
                    initialQuantity: assignment.initialQuantity || 0,
                    storePrice: assignment.storePrice
                });
            }
        }

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: createdBy,
                action: "PRODUCT_CREATED",
                entityType: "PRODUCT",
                entityId: product.id,
                details: {
                    name,
                    type,
                    grade,
                    storeAssignments: storeAssignments?.length || 0
                },
                createdAt: new Date()
            }
        });

        return { product, storeAssignments: assignments };
    });
};

/**
 * Update product details
 * Cannot change product type once set
 * 
 * @param productId Product ID to update
 * @param updates Fields to update
 * @param updatedBy User ID making the update
 */
export const updateProduct = async (
    productId: string,
    updates: {
        name?: string;
        basePrice?: number;
        grade?: ProductGrade;
        commodity?: string;
        tireSpecific?: {
            tireCategory?: TireCategory;
            tireUsage?: TireUsage;
            tireSize?: string;
            loadIndex?: string;
            speedRating?: string;
            warrantyPeriod?: string;
        };
        baleSpecific?: {
            baleWeight?: number;
            baleCategory?: string;
            originCountry?: string;
            importDate?: Date;
        };
    },
    updatedBy: string
): Promise<any> => {
    // Validate at least one field is being updated
    if (Object.keys(updates).length === 0) {
        throw new Error("NO_UPDATES_PROVIDED: At least one field must be updated");
    }

    if (updates.basePrice !== undefined && updates.basePrice < 0) {
        throw new Error("INVALID_PRICE: Base price cannot be negative");
    }

    if (updates.name) {
        // Check if new name already exists for another product
        const existingProduct = await prisma.product.findUnique({
            where: { name: updates.name }
        });
        if (existingProduct && existingProduct.id !== productId) {
            throw new Error("PRODUCT_EXISTS: Another product with this name already exists");
        }
    }

    // Get current product to check type
    const currentProduct = await prisma.product.findUnique({
        where: { id: productId }
    });
    if (!currentProduct) {
        throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
    }

    // Build update data
    const updateData: any = { updatedAt: new Date() };

    if (updates.name) updateData.name = updates.name;
    if (updates.basePrice !== undefined) updateData.basePrice = updates.basePrice;
    if (updates.grade) updateData.grade = updates.grade;
    if (updates.commodity !== undefined) updateData.commodity = updates.commodity;

    // Handle type-specific updates
    if (currentProduct.type === ProductType.TIRE && updates.tireSpecific) {
        if (updates.tireSpecific.tireCategory !== undefined)
            updateData.tireCategory = updates.tireSpecific.tireCategory;
        if (updates.tireSpecific.tireUsage !== undefined)
            updateData.tireUsage = updates.tireSpecific.tireUsage;
        if (updates.tireSpecific.tireSize !== undefined)
            updateData.tireSize = updates.tireSpecific.tireSize;
        if (updates.tireSpecific.loadIndex !== undefined)
            updateData.loadIndex = updates.tireSpecific.loadIndex;
        if (updates.tireSpecific.speedRating !== undefined)
            updateData.speedRating = updates.tireSpecific.speedRating;
        if (updates.tireSpecific.warrantyPeriod !== undefined)
            updateData.warrantyPeriod = updates.tireSpecific.warrantyPeriod;
    } else if (currentProduct.type === ProductType.BALE && updates.baleSpecific) {
        if (updates.baleSpecific.baleWeight !== undefined)
            updateData.baleWeight = updates.baleSpecific.baleWeight;
        if (updates.baleSpecific.baleCategory !== undefined)
            updateData.baleCategory = updates.baleSpecific.baleCategory;
        if (updates.baleSpecific.originCountry !== undefined)
            updateData.originCountry = updates.baleSpecific.originCountry;
        if (updates.baleSpecific.importDate !== undefined)
            updateData.importDate = updates.baleSpecific.importDate;
    }

    // Update product
    const updatedProduct = await prisma.product.update({
        where: { id: productId },
        data: updateData
    });

    // Log activity
    await prisma.activityLog.create({
        data: {
            userId: updatedBy,
            action: "PRODUCT_UPDATED",
            entityType: "PRODUCT",
            entityId: productId,
            details: { updatedFields: Object.keys(updates) },
            createdAt: new Date()
        }
    });

    return updatedProduct;
};

/**
 * Archive product (soft delete)
 * Cannot archive if product has inventory or recent sales
 * 
 * @param productId Product ID to archive
 * @param archivedBy User ID performing archive
 * @param reason Optional reason for archiving
 */
export const archiveProduct = async (
    productId: string,
    archivedBy: string,
    reason?: string
): Promise<void> => {
    // Transaction: Check constraints + archive + log activity
    await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
            where: { id: productId },
            include: {
                inventories: {
                    where: { quantity: { gt: 0 } }
                },
                saleItems: {
                    where: {
                        sale: {
                            createdAt: {
                                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                            }
                        }
                    },
                    take: 1
                }
            }
        });

        if (!product) {
            throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
        }

        // Check for existing inventory
        if (product.inventories.length > 0) {
            const totalInventory = product.inventories.reduce((sum, inv) => sum + inv.quantity, 0);
            throw new Error(
                `PRODUCT_HAS_INVENTORY: Cannot archive product with ${totalInventory} units in inventory`
            );
        }

        // Check for recent sales
        if (product.saleItems.length > 0) {
            throw new Error(
                "PRODUCT_HAS_RECENT_SALES: Cannot archive product with sales in the last 30 days"
            );
        }

        // In a real system, you might:
        // 1. Add an `archivedAt` timestamp field
        // 2. Or move to an archived products table
        // 3. Or just prevent deletion (which we're doing)

        // For now, we'll just prevent deletion and log the request
        await tx.activityLog.create({
            data: {
                userId: archivedBy,
                action: "PRODUCT_ARCHIVE_REQUESTED",
                entityType: "PRODUCT",
                entityId: productId,
                details: { reason, action: "PREVENTED_DELETION" },
                createdAt: new Date()
            }
        });
    });

    throw new Error("PRODUCT_DELETION_PREVENTED: Products cannot be deleted. Consider marking as discontinued instead.");
};

/**
 * Assign product to additional stores
 * Creates StoreProduct records and optionally initial inventory
 * 
 * @param productId Product ID
 * @param storeIds Array of store IDs to assign to
 * @param initialQuantities Optional initial quantities per store
 * @param assignedBy User ID making assignment
 */
export const assignProductToStores = async (
    productId: string,
    storeIds: string[],
    assignedBy: string,
    initialQuantities?: Record<string, number>,
): Promise<Array<{ storeId: string; storeProduct: any; inventory?: any }>> => {
    if (storeIds.length === 0) {
        throw new Error("NO_STORES_PROVIDED: At least one store must be provided");
    }

    // Transaction: Create assignments + initial inventory atomically
    return await prisma.$transaction(async (tx) => {
        // Verify product exists
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) {
            throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
        }

        const results = [];

        for (const storeId of storeIds) {
            // Verify store exists
            const store = await tx.store.findUnique({ where: { id: storeId } });
            if (!store) {
                throw new Error(`STORE_NOT_FOUND: Store ${storeId} does not exist`);
            }

            // Check if already assigned
            const existingAssignment = await tx.storeProduct.findUnique({
                where: {
                    productId_storeId: {
                        productId,
                        storeId
                    }
                }
            });

            if (existingAssignment) {
                throw new Error(`PRODUCT_ALREADY_ASSIGNED: Product is already assigned to store ${store.name}`);
            }

            // Create StoreProduct assignment
            const storeProduct = await tx.storeProduct.create({
                data: {
                    productId,
                    storeId,
                    createdAt: new Date()
                }
            });

            let inventory = null;

            // Create initial inventory if specified
            const initialQty = initialQuantities?.[storeId];
            if (initialQty && initialQty > 0) {
                inventory = await tx.inventory.create({
                    data: {
                        productId,
                        storeId,
                        quantity: initialQty,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                });

                // Create inventory history
                await tx.inventoryHistory.create({
                    data: {
                        inventoryId: inventory.id,
                        changeType: "PURCHASE",
                        quantityChange: initialQty,
                        previousQuantity: 0,
                        newQuantity: initialQty,
                        referenceType: "STORE_ASSIGNMENT",
                        notes: `Initial stock for product assignment to ${store.name}`,
                        createdBy: assignedBy,
                        createdAt: new Date()
                    }
                });
            }

            results.push({ storeId, storeProduct, inventory });
        }

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: assignedBy,
                action: "PRODUCT_ASSIGNED_TO_STORES",
                entityType: "PRODUCT",
                entityId: productId,
                details: {
                    storeCount: storeIds.length,
                    stores: storeIds
                },
                createdAt: new Date()
            }
        });

        return results;
    });
};

/**
 * Remove product from store (if no inventory exists)
 * 
 * @param productId Product ID
 * @param storeId Store ID to remove from
 * @param removedBy User ID performing removal
 */
export const removeProductFromStore = async (
    productId: string,
    storeId: string,
    removedBy: string
): Promise<void> => {
    await prisma.$transaction(async (tx) => {
        // Check if product has inventory in this store
        const inventory = await tx.inventory.findUnique({
            where: {
                productId_storeId: {
                    productId,
                    storeId
                }
            }
        });

        if (inventory && inventory.quantity > 0) {
            throw new Error(
                `PRODUCT_HAS_INVENTORY: Cannot remove product with ${inventory.quantity} units in inventory`
            );
        }

        // Delete inventory record if exists (with zero quantity)
        if (inventory) {
            await tx.inventory.delete({
                where: {
                    productId_storeId: {
                        productId,
                        storeId
                    }
                }
            });
        }

        // Delete StoreProduct assignment
        await tx.storeProduct.delete({
            where: {
                productId_storeId: {
                    productId,
                    storeId
                }
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: removedBy,
                action: "PRODUCT_REMOVED_FROM_STORE",
                entityType: "PRODUCT",
                entityId: productId,
                details: { storeId },
                createdAt: new Date()
            }
        });
    });
};

/**
 * Get product details with inventory across all stores
 * 
 * @param productId Product ID
 */
export const getProductWithInventory = async (
    productId: string
): Promise<any> => {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
            inventories: {
                include: {
                    store: {
                        select: {
                            id: true,
                            name: true,
                            location: true,
                            isMainStore: true
                        }
                    }
                }
            },
            storeProducts: {
                include: {
                    store: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            },
            _count: {
                select: {
                    saleItems: true,
                    transfers: true
                }
            }
        }
    });

    if (!product) {
        throw new Error("PRODUCT_NOT_FOUND: Product does not exist");
    }

    return product;
};

/**
 * Search products with filters
 * 
 * @param filters Search filters
 * @param page Page number
 * @param limit Items per page
 */
export const searchProducts = async (
    filters: {
        name?: string;
        type?: ProductType;
        grade?: ProductGrade;
        commodity?: string;
        tireCategory?: TireCategory;
        tireUsage?: TireUsage;
        minPrice?: number;
        maxPrice?: number;
        inStock?: boolean; // Only products with inventory > 0
        storeId?: string; // Products available in specific store
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    products: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.name) {
        whereCondition.name = { contains: filters.name, mode: 'insensitive' };
    }
    if (filters.type) {
        whereCondition.type = filters.type;
    }
    if (filters.grade) {
        whereCondition.grade = filters.grade;
    }
    if (filters.commodity) {
        whereCondition.commodity = { contains: filters.commodity, mode: 'insensitive' };
    }
    if (filters.tireCategory) {
        whereCondition.tireCategory = filters.tireCategory;
    }
    if (filters.tireUsage) {
        whereCondition.tireUsage = filters.tireUsage;
    }
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
        whereCondition.basePrice = {};
        if (filters.minPrice !== undefined) whereCondition.basePrice.gte = filters.minPrice;
        if (filters.maxPrice !== undefined) whereCondition.basePrice.lte = filters.maxPrice;
    }

    // Filter by store availability
    if (filters.storeId) {
        whereCondition.storeProducts = {
            some: {
                storeId: filters.storeId
            }
        };
    }

    // Filter by stock availability
    if (filters.inStock !== undefined) {
        if (filters.inStock) {
            whereCondition.inventories = {
                some: {
                    quantity: { gt: 0 }
                }
            };
        } else {
            whereCondition.inventories = {
                every: {
                    quantity: 0
                }
            };
        }
    }

    const [products, total] = await Promise.all([
        prisma.product.findMany({
            where: whereCondition,
            include: {
                inventories: {
                    select: {
                        storeId: true,
                        quantity: true,
                        storePrice: true
                    }
                },
                _count: {
                    select: {
                        saleItems: true,
                        transfers: true
                    }
                }
            },
            orderBy: { name: 'asc' },
            skip,
            take: limit
        }),
        prisma.product.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        products,
        total,
        page,
        totalPages
    };
};

/**
 * Get low stock products across all stores
 * 
 * @param threshold Threshold for low stock (default: below reorderLevel or 10)
 */
export const getLowStockProducts = async (
    threshold: number = 10
): Promise<Array<{
    product: any;
    inventories: Array<{
        storeId: string;
        storeName: string;
        quantity: number;
        reorderLevel?: number;
        optimalLevel?: number;
    }>;
}>> => {
    const inventories = await prisma.inventory.findMany({
        where: {
            OR: [
                { quantity: { lte: threshold } },
                {
                    AND: [
                        { reorderLevel: { not: null } },
                        { quantity: { lte: prisma.inventory.fields.reorderLevel } }
                    ]
                }
            ]
        },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    grade: true,
                    basePrice: true
                }
            },
            store: {
                select: {
                    id: true,
                    name: true
                }
            }
        },
        orderBy: { quantity: 'asc' }
    });

    // Group by product
    const productMap = new Map();

    inventories.forEach(inv => {
        if (!productMap.has(inv.productId)) {
            productMap.set(inv.productId, {
                product: inv.product,
                inventories: []
            });
        }

        productMap.get(inv.productId).inventories.push({
            storeId: inv.storeId,
            storeName: inv.store.name,
            quantity: inv.quantity,
            reorderLevel: inv.reorderLevel,
            optimalLevel: inv.optimalLevel
        });
    });

    return Array.from(productMap.values());
};