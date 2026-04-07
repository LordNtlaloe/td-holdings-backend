// controllers/product-controller.ts
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta } from "../helpers";

// Define custom type for authenticated request
interface AuthenticatedRequest extends Request {
    user?: {
        storeId?: string;
        id: string;
        email: string;
        role: string;
    };
}

// Define proper types for inventory with store
interface InventoryWithStore {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    storeId: string;
    productId: string;
    quantity: number;
    reorderLevel: number | null;
    optimalLevel: number | null;
    storePrice: number | null;
    store: {
        id: string;
        name: string;
        isMainStore: boolean;
        city?: string | null;
    };
}

interface ProductWithInventories {
    id: string;
    name: string;
    description: string | null;
    basePrice: number;
    type: string;
    grade: string;
    commodity: string | null;
    tireCategory: string | null;
    tireUsage: string | null;
    tireSize: string | null;
    loadIndex: string | null;
    speedRating: string | null;
    warrantyPeriod: number | null;
    baleWeight: number | null;
    baleCategory: string | null;
    originCountry: string | null;
    importDate: Date | null;
    isActive: boolean;
    rating: number;
    reviewCount: number;
    createdAt: Date;
    updatedAt: Date;
    inventories: InventoryWithStore[];
    _count?: {
        saleItems: number;
        transfers: number;
    };
    stockReceipts?: any[];
}

export const getProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 20,
            sortBy,
            sortOrder,
            search,
            type,
            grade,
            minPrice,
            maxPrice,
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        // Build where clause
        const where: any = {};

        // Search filter
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { commodity: { contains: search as string, mode: 'insensitive' } },
                { tireSize: { contains: search as string, mode: 'insensitive' } },
                { originCountry: { contains: search as string, mode: 'insensitive' } },
            ];
        }

        // Type filter
        if (type) {
            where.type = type;
        }

        // Grade filter
        if (grade) {
            where.grade = grade;
        }

        // Price filter
        if (minPrice || maxPrice) {
            where.basePrice = {};
            if (minPrice) where.basePrice.gte = Number(minPrice);
            if (maxPrice) where.basePrice.lte = Number(maxPrice);
        }

        // For non-admin/non-manager users, filter by their store
        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        if (isRestrictedUser && req.user?.storeId) {
            where.inventories = {
                some: {
                    storeId: req.user.storeId
                }
            };
        }

        // Get products with inventories
        const products = await prisma.product.findMany({
            where,
            skip,
            take,
            orderBy: sortBy ? { [sortBy as string]: sortOrder || 'desc' } : { createdAt: 'desc' },
            include: {
                inventories: {
                    where: isRestrictedUser && req.user?.storeId
                        ? { storeId: req.user.storeId }
                        : undefined,
                    include: {
                        store: {
                            select: {
                                id: true,
                                name: true,
                                isMainStore: true,
                                city: true
                            },
                        },
                    },
                },
            },
        });

        // Get total count
        const total = await prisma.product.count({ where });

        // Calculate inventory for each product with proper type casting
        const productsWithInventory = (products as ProductWithInventories[]).map((product) => {
            const totalInventory = product.inventories.reduce(
                (sum: number, inv: InventoryWithStore) => sum + inv.quantity,
                0
            );

            const mainStoreInventory = product.inventories.find(
                (inv: InventoryWithStore) => inv.store?.isMainStore
            )?.quantity || 0;

            const branchInventory = totalInventory - mainStoreInventory;

            return {
                ...product,
                inventory: {
                    total: totalInventory,
                    mainStore: mainStoreInventory,
                    branches: branchInventory,
                    byStore: product.inventories.map((inv: InventoryWithStore) => ({
                        storeId: inv.storeId,
                        storeName: inv.store?.name,
                        isMainStore: inv.store?.isMainStore,
                        quantity: inv.quantity,
                        reorderLevel: inv.reorderLevel,
                        optimalLevel: inv.optimalLevel,
                        storePrice: inv.storePrice,
                    })),
                },
            };
        });

        res.json({
            data: productsWithInventory,
            meta: generateMeta(total, Number(page), Number(limit)),
            userStore: req.user?.storeId, // Include user's store for frontend context
        });
    } catch (error) {
        console.error("Get products error:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const getProductById = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const productId = Array.isArray(id) ? id[0] : id;

        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        // Build include condition based on user role
        const includeInventory: any = {
            include: {
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true,
                        city: true
                    }
                },
            },
        };

        // For non-admin/non-manager users, only show their store's inventory
        if (isRestrictedUser && req.user?.storeId) {
            includeInventory.where = {
                storeId: req.user.storeId
            };
        }

        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                inventories: includeInventory,
                stockReceipts: {
                    orderBy: {
                        receivedAt: "desc",
                    },
                    take: 10,
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        saleItems: true,
                        transfers: true,
                    },
                },
            },
        }) as (ProductWithInventories & { stockReceipts: any[] }) | null;

        if (!product) {
            res.status(404).json({ error: "Product not found" });
            return;
        }

        // Check if user has access to this product (if it has inventory in their store)
        if (isRestrictedUser && req.user?.storeId) {
            const hasAccess = product.inventories.some(inv => inv.storeId === req.user?.storeId);
            if (!hasAccess) {
                res.status(403).json({
                    error: "You don't have access to this product"
                });
                return;
            }
        }

        // Calculate inventory summary
        const totalInventory = product.inventories.reduce(
            (sum: number, inv: InventoryWithStore) => sum + inv.quantity,
            0
        );
        const mainStoreInventory = product.inventories.find(
            (inv: InventoryWithStore) => inv.store?.isMainStore
        )?.quantity || 0;
        const branchInventory = totalInventory - mainStoreInventory;

        // Get recent sales (filtered by store if needed)
        const recentSalesWhere: any = { productId: productId };
        if (isRestrictedUser && req.user?.storeId) {
            recentSalesWhere.sale = {
                storeId: req.user.storeId
            };
        }

        const recentSales = await prisma.saleItem.findMany({
            where: recentSalesWhere,
            orderBy: {
                sale: { createdAt: "desc" },
            },
            take: 10,
            include: {
                sale: {
                    include: {
                        store: {
                            select: {
                                id: true,
                                name: true,
                                isMainStore: true
                            }
                        },
                        employee: {
                            include: {
                                user: {
                                    select: {
                                        firstName: true,
                                        lastName: true
                                    }
                                },
                            },
                        },
                    },
                },
            },
        });

        // Get stock movement
        const stockMovementWhere: any = {
            inventory: {
                productId: productId
            },
            createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
            }
        };

        // Filter by store for non-admin users
        if (isRestrictedUser && req.user?.storeId) {
            stockMovementWhere.inventory.storeId = req.user.storeId;
        }

        const stockMovement = await prisma.inventoryHistory.findMany({
            where: stockMovementWhere,
            include: {
                inventory: {
                    include: {
                        store: {
                            select: {
                                name: true,
                                isMainStore: true
                            }
                        }
                    }
                },
                user: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        // Group stock movement by day
        const groupedStockMovement = stockMovement.reduce((acc: any, movement: any) => {
            const date = movement.createdAt.toISOString().split('T')[0];
            if (!acc[date]) {
                acc[date] = {
                    date,
                    changes: [],
                    totalChange: 0
                };
            }
            acc[date].changes.push(movement);
            acc[date].totalChange += movement.quantityChange;
            return acc;
        }, {} as Record<string, any>);

        res.json({
            product,
            inventory: {
                total: totalInventory,
                mainStore: mainStoreInventory,
                branches: branchInventory,
                byStore: product.inventories.map((inv: InventoryWithStore) => ({
                    storeId: inv.storeId,
                    storeName: inv.store?.name,
                    isMainStore: inv.store?.isMainStore,
                    quantity: inv.quantity,
                    reorderLevel: inv.reorderLevel,
                    optimalLevel: inv.optimalLevel,
                    storePrice: inv.storePrice,
                })),
            },
            recentSales,
            stockMovement: Object.values(groupedStockMovement).reverse(),
            metrics: {
                totalSales: product._count?.saleItems || 0,
                totalTransfers: product._count?.transfers || 0,
                totalStockReceipts: product.stockReceipts?.length || 0,
            },
        });
    } catch (error) {
        console.error("Get product error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const createProduct = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const {
            name,
            description,
            basePrice,
            type,
            grade,
            commodity,
            tireCategory,
            tireUsage,
            tireSize,
            loadIndex,
            speedRating,
            warrantyPeriod,
            baleWeight,
            baleCategory,
            originCountry,
            importDate,
            warehouseQuantity = 0,
            warehouseReorderLevel,
            warehouseOptimalLevel,
            storeAssignments = [],
            isActive = true,
        } = req.body;

        console.log('🟦 Received product data:', JSON.stringify(req.body, null, 2));
        console.log('🟦 Received storeAssignments:', JSON.stringify(storeAssignments, null, 2));

        // Validation
        if (!name || basePrice === undefined || !type || !grade) {
            res.status(400).json({
                error: "Name, base price, type, and grade are required",
            });
            return;
        }

        // Type-specific validation
        if (type === 'TIRE' && (!tireCategory || !tireUsage)) {
            res.status(400).json({
                error: "Tire category and tire usage are required for tire products",
            });
            return;
        }

        if (type === 'BALE' && !baleWeight) {
            res.status(400).json({
                error: "Bale weight is required for bale products",
            });
            return;
        }

        // Check if product already exists
        const existingProduct = await prisma.product.findUnique({
            where: { name },
        });

        if (existingProduct) {
            res.status(400).json({
                error: "Product with this name already exists",
            });
            return;
        }

        // Find the main store
        const mainStore = await prisma.store.findFirst({
            where: { isMainStore: true },
        });

        if (!mainStore) {
            res.status(400).json({
                error: "No main store found. Please configure a main store first.",
            });
            return;
        }

        // Format importDate correctly
        let formattedImportDate = null;
        if (importDate) {
            formattedImportDate = new Date(importDate);
            if (isNaN(formattedImportDate.getTime())) {
                res.status(400).json({
                    error: "Invalid import date format",
                });
                return;
            }
        }

        // Filter only assigned branch stores (isMainStore = false AND isAssigned = true)
        const branchAssignments = storeAssignments.filter((assignment: any) => {
            return !assignment.isMainStore && assignment.isAssigned === true;
        });

        console.log('🟦 Branch assignments to process:', branchAssignments.length);
        console.log('🟦 Branch assignments details:', JSON.stringify(branchAssignments, null, 2));

        // Calculate totals - Filter only assigned branch stores
        const branchQuantities = branchAssignments.reduce((sum: number, assignment: any) => {
            return sum + (assignment.existingQuantity || 0);
        }, 0);

        const totalSystemQuantity = warehouseQuantity + branchQuantities;

        console.log('🟦 Creating product with:', {
            name,
            type,
            grade,
            basePrice,
            tireCategory,
            tireUsage,
            tireSize,
            baleWeight,
            baleCategory,
            originCountry,
            importDate: formattedImportDate,
            warehouseQuantity,
            warehouseReorderLevel,
            warehouseOptimalLevel,
            branchAssignmentsCount: branchAssignments.length,
            branchQuantities,
            totalSystemQuantity,
        });

        // Use transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create the product with ALL fields
            const productData: any = {
                name,
                description: description || null,
                basePrice: Number(basePrice),
                type: type,
                grade: grade,
                commodity: commodity || null,
                isActive,
                rating: 0,
                reviewCount: 0,
            };

            // Add tire-specific fields if product is TIRE
            if (type === 'TIRE') {
                productData.tireCategory = tireCategory;
                productData.tireUsage = tireUsage;
                productData.tireSize = tireSize || null;
                productData.loadIndex = loadIndex || null;
                productData.speedRating = speedRating || null;
                productData.warrantyPeriod = warrantyPeriod || null;
                // Clear bale-specific fields for tire products
                productData.baleWeight = null;
                productData.baleCategory = null;
                productData.originCountry = null;
                productData.importDate = null;
            }

            // Add bale-specific fields if product is BALE
            if (type === 'BALE') {
                productData.baleWeight = baleWeight ? Number(baleWeight) : null;
                productData.baleCategory = baleCategory || null;
                productData.originCountry = originCountry || null;
                productData.importDate = formattedImportDate;
                // Clear tire-specific fields for bale products
                productData.tireCategory = null;
                productData.tireUsage = null;
                productData.tireSize = null;
                productData.loadIndex = null;
                productData.speedRating = null;
                productData.warrantyPeriod = null;
            }

            console.log('🟦 Product data for creation:', JSON.stringify(productData, null, 2));

            const product = await tx.product.create({
                data: productData,
            });

            console.log('🟦 Product created:', product.id);

            // 2. Create MAIN STORE inventory (warehouse)
            const mainStoreInventory = await tx.inventory.create({
                data: {
                    productId: product.id,
                    storeId: mainStore.id,
                    quantity: Number(warehouseQuantity),
                    reorderLevel: warehouseReorderLevel ? Number(warehouseReorderLevel) : null,
                    optimalLevel: warehouseOptimalLevel ? Number(warehouseOptimalLevel) : null,
                    storePrice: null,
                },
            });

            // Create StoreProduct for main store
            await tx.storeProduct.create({
                data: {
                    productId: product.id,
                    storeId: mainStore.id,
                },
            });

            // Log main store inventory creation
            if (warehouseQuantity > 0) {
                await tx.inventoryHistory.create({
                    data: {
                        inventoryId: mainStoreInventory.id,
                        changeType: "INITIAL_SETUP",
                        quantityChange: Number(warehouseQuantity),
                        previousQuantity: 0,
                        newQuantity: Number(warehouseQuantity),
                        createdBy: req.user!.id,
                        notes: `Initial stock in main store/warehouse: ${warehouseQuantity} units`,
                    },
                });
            }

            const storeInventories = [mainStoreInventory];

            // 3. Create BRANCH STORE inventories (existing stock from before system)
            if (branchAssignments.length > 0) {
                console.log('🟦 Processing branch assignments...');

                for (const assignment of branchAssignments) {
                    const store = await tx.store.findUnique({
                        where: { id: assignment.storeId }
                    });

                    if (!store) {
                        console.warn(`⚠️ Store not found: ${assignment.storeId}`);
                        continue;
                    }

                    console.log(`🟦 Creating inventory for branch store: ${store.name} (${assignment.storeId})`);

                    // Create store product relationship
                    await tx.storeProduct.create({
                        data: {
                            productId: product.id,
                            storeId: assignment.storeId,
                        },
                    });

                    const existingQuantity = assignment.existingQuantity || 0;

                    console.log(`🟦 Creating inventory with quantity: ${existingQuantity}`);

                    // Create inventory with existing quantity (pre-system stock)
                    const inventory = await tx.inventory.create({
                        data: {
                            productId: product.id,
                            storeId: assignment.storeId,
                            quantity: Number(existingQuantity),
                            reorderLevel: assignment.reorderLevel ? Number(assignment.reorderLevel) : null,
                            optimalLevel: assignment.optimalLevel ? Number(assignment.optimalLevel) : null,
                            storePrice: assignment.storePrice || null,
                        },
                    });

                    storeInventories.push(inventory);

                    // Log branch inventory creation if quantity > 0
                    if (existingQuantity > 0) {
                        await tx.inventoryHistory.create({
                            data: {
                                inventoryId: inventory.id,
                                changeType: "INITIAL_SETUP",
                                quantityChange: Number(existingQuantity),
                                previousQuantity: 0,
                                newQuantity: Number(existingQuantity),
                                createdBy: req.user!.id,
                                notes: `Initial stock from before system: ${existingQuantity} units`,
                            },
                        });
                    }

                    console.log(`✅ Created inventory for branch store ${store.name}`);
                }
            } else {
                console.log('🟦 No branch assignments to process');
            }

            return {
                product,
                storeInventories,
                warehouseQuantity,
                branchQuantities,
                totalSystemQuantity,
            };
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: "PRODUCT_CREATED",
                    entityType: "PRODUCT",
                    entityId: result.product.id,
                    details: {
                        productName: name,
                        warehouseQuantity: result.warehouseQuantity,
                        branchQuantities: result.branchQuantities,
                        totalQuantity: result.totalSystemQuantity,
                        storeCount: result.storeInventories.length,
                        branchStoreCount: branchAssignments.length,
                    },
                },
            });
        }

        // Fetch the complete product with all fields to return
        const completeProduct = await prisma.product.findUnique({
            where: { id: result.product.id },
            include: {
                inventories: {
                    include: {
                        store: true,
                    },
                },
            },
        });

        console.log('🟦 Complete product after creation:', JSON.stringify(completeProduct, null, 2));

        res.status(201).json({
            success: true,
            message: "Product created successfully",
            data: {
                product: completeProduct,
                assignedStores: result.storeInventories.length,
                inventory: {
                    mainStore: result.warehouseQuantity,
                    branches: result.branchQuantities,
                    total: result.totalSystemQuantity,
                },
            },
        });
    } catch (error) {
        console.error("🔴 Create product error:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const updateProduct = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const productId = Array.isArray(id) ? id[0] : id;

        const {
            name,
            description,
            basePrice,
            type,
            grade,
            commodity,
            tireCategory,
            tireUsage,
            tireSize,
            loadIndex,
            speedRating,
            warrantyPeriod,
            baleWeight,
            baleCategory,
            originCountry,
            importDate,
            isActive,
        } = req.body;

        console.log('🟦 Updating product data:', JSON.stringify(req.body, null, 2));

        const product = await prisma.product.findUnique({
            where: { id: productId },
        });

        if (!product) {
            res.status(404).json({ error: "Product not found" });
            return;
        }

        // Format importDate correctly
        let formattedImportDate = undefined;
        if (importDate !== undefined) {
            if (importDate) {
                formattedImportDate = new Date(importDate);
                if (isNaN(formattedImportDate.getTime())) {
                    res.status(400).json({
                        error: "Invalid import date format",
                    });
                    return;
                }
            } else {
                formattedImportDate = null;
            }
        }

        // Check if name is being changed and already exists
        if (name && name !== product.name) {
            const existingProduct = await prisma.product.findUnique({
                where: { name },
            });

            if (existingProduct) {
                res.status(400).json({
                    error: "Product with this name already exists",
                });
                return;
            }
        }

        // Build update data object
        const updateData: any = {};

        // Basic fields
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
        if (type !== undefined) updateData.type = type;
        if (grade !== undefined) updateData.grade = grade;
        if (commodity !== undefined) updateData.commodity = commodity;
        if (isActive !== undefined) updateData.isActive = isActive;

        // Tire-specific fields
        if (tireCategory !== undefined) updateData.tireCategory = tireCategory;
        if (tireUsage !== undefined) updateData.tireUsage = tireUsage;
        if (tireSize !== undefined) updateData.tireSize = tireSize;
        if (loadIndex !== undefined) updateData.loadIndex = loadIndex;
        if (speedRating !== undefined) updateData.speedRating = speedRating;
        if (warrantyPeriod !== undefined) updateData.warrantyPeriod = warrantyPeriod;

        // Bale-specific fields
        if (baleWeight !== undefined) updateData.baleWeight = baleWeight ? Number(baleWeight) : null;
        if (baleCategory !== undefined) updateData.baleCategory = baleCategory;
        if (originCountry !== undefined) updateData.originCountry = originCountry;
        if (importDate !== undefined) updateData.importDate = formattedImportDate;

        // Clear tire-specific fields if switching from TIRE to BALE
        if (type === 'BALE' && product.type === 'TIRE') {
            updateData.tireCategory = null;
            updateData.tireUsage = null;
            updateData.tireSize = null;
            updateData.loadIndex = null;
            updateData.speedRating = null;
            updateData.warrantyPeriod = null;
        }

        // Clear bale-specific fields if switching from BALE to TIRE
        if (type === 'TIRE' && product.type === 'BALE') {
            updateData.baleWeight = null;
            updateData.baleCategory = null;
            updateData.originCountry = null;
            updateData.importDate = null;
        }

        console.log('🟦 Update data:', JSON.stringify(updateData, null, 2));

        const updatedProduct = await prisma.product.update({
            where: { id: productId },
            data: updateData,
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: "PRODUCT_UPDATED",
                    entityType: "PRODUCT",
                    entityId: productId,
                    details: {
                        updatedFields: Object.keys(updateData),
                    },
                },
            });
        }

        res.json(updatedProduct);
    } catch (error) {
        console.error("🔴 Update product error:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error"
        });
    }
};

export const deleteProduct = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const productId = Array.isArray(id) ? id[0] : id;

        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                _count: {
                    select: {
                        inventories: true,
                        saleItems: true,
                        transfers: true,
                    },
                },
            },
        });

        if (!product) {
            res.status(404).json({ error: "Product not found" });
            return;
        }

        // Check if product has any stock in any store
        const hasStock = await prisma.inventory.findFirst({
            where: {
                productId: productId,
                quantity: { gt: 0 }
            }
        });

        if (hasStock) {
            res.status(400).json({
                error: "Cannot delete product with existing stock. Please transfer or sell all stock first.",
            });
            return;
        }

        // Use transaction to delete related records
        await prisma.$transaction(async (tx) => {
            // Delete inventory histories
            await tx.inventoryHistory.deleteMany({
                where: {
                    inventory: {
                        productId: productId
                    }
                }
            });

            // Delete inventories
            await tx.inventory.deleteMany({
                where: { productId: productId }
            });

            // Delete store products
            await tx.storeProduct.deleteMany({
                where: { productId: productId }
            });

            // Delete product
            await tx.product.delete({
                where: { id: productId },
            });
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: "PRODUCT_DELETED",
                    entityType: "PRODUCT",
                    entityId: productId,
                    details: {
                        productName: product.name,
                    },
                },
            });
        }

        res.json({ message: "Product deleted successfully" });
    } catch (error) {
        console.error("Delete product error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getProductStockAnalysis = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const productId = Array.isArray(id) ? id[0] : id;
        const { period = "30d" } = req.query;

        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                inventories: {
                    where: isRestrictedUser && req.user?.storeId
                        ? { storeId: req.user.storeId }
                        : undefined,
                    include: {
                        store: true,
                    },
                },
            },
        });

        if (!product) {
            res.status(404).json({ error: "Product not found" });
            return;
        }

        // Calculate date range
        const endDate = new Date();
        let startDate = new Date();

        switch (period) {
            case "7d":
                startDate.setDate(startDate.getDate() - 7);
                break;
            case "30d":
                startDate.setDate(startDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(startDate.getDate() - 90);
                break;
            case "1y":
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 30);
        }

        // Get sales data (filtered by store if needed)
        const salesWhere: any = {
            productId: productId,
            sale: {
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            }
        };

        if (isRestrictedUser && req.user?.storeId) {
            salesWhere.sale.storeId = req.user.storeId;
        }

        const salesData = await prisma.saleItem.findMany({
            where: salesWhere,
            include: {
                sale: {
                    include: {
                        store: true
                    }
                }
            },
            orderBy: {
                sale: {
                    createdAt: 'desc'
                }
            }
        });

        // Get store inventory
        const storeInventory = await prisma.inventory.findMany({
            where: {
                productId: productId,
                ...(isRestrictedUser && req.user?.storeId ? { storeId: req.user.storeId } : {})
            },
            include: {
                store: {
                    select: {
                        id: true,
                        name: true,
                        city: true,
                        isMainStore: true
                    }
                }
            }
        });

        // Get transfer history (filtered by store if needed)
        const transferWhere: any = {
            productId: productId,
            createdAt: {
                gte: startDate
            }
        };

        if (isRestrictedUser && req.user?.storeId) {
            transferWhere.OR = [
                { fromStoreId: req.user.storeId },
                { toStoreId: req.user.storeId }
            ];
        }

        const transferHistory = await prisma.productTransfer.findMany({
            where: transferWhere,
            include: {
                fromStore: {
                    select: {
                        name: true,
                        isMainStore: true
                    }
                },
                toStore: {
                    select: {
                        name: true,
                        isMainStore: true
                    }
                },
                transferredByUser: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        // Calculate metrics
        const totalSales = salesData.reduce((sum, item) => sum + item.quantity, 0);
        const totalRevenue = salesData.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        const avgDailySales = salesData.length > 0 ? totalSales / salesData.length : 0;

        const totalInventory = storeInventory.reduce((sum, store) => sum + store.quantity, 0);
        const mainStoreInventory = storeInventory.find(s => s.store?.isMainStore)?.quantity || 0;
        const branchInventory = totalInventory - mainStoreInventory;

        // Calculate stock status
        const storeInventoryWithStatus = storeInventory.map(store => {
            const stockStatus = store.quantity < (store.reorderLevel || 10)
                ? 'LOW_STOCK'
                : store.quantity > (store.optimalLevel || 50)
                    ? 'HIGH_STOCK'
                    : 'OPTIMAL';

            return {
                ...store,
                stock_status: stockStatus
            };
        });

        const lowStockStores = storeInventoryWithStatus.filter(s => s.stock_status === 'LOW_STOCK').length;
        const highStockStores = storeInventoryWithStatus.filter(s => s.stock_status === 'HIGH_STOCK').length;

        res.json({
            product,
            period: {
                startDate,
                endDate,
                period,
            },
            salesData,
            storeInventory: storeInventoryWithStatus,
            transferHistory,
            metrics: {
                sales: {
                    totalSold: totalSales,
                    totalRevenue,
                    avgDailySales,
                    salesDays: salesData.length,
                },
                inventory: {
                    total: totalInventory,
                    mainStore: mainStoreInventory,
                    branches: branchInventory,
                    avgStoreStock: storeInventory.length > 0 ? totalInventory / storeInventory.length : 0,
                    lowStockStores,
                    highStockStores,
                },
            },
        });
    } catch (error) {
        console.error("Get product stock analysis error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const bulkUpdateProducts = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { products } = req.body;

        if (!Array.isArray(products) || products.length === 0) {
            res.status(400).json({ error: "Products array is required" });
            return;
        }

        const updates = products.map((product) => {
            const { id, ...updateData } = product;
            return prisma.product.update({
                where: { id },
                data: updateData,
            });
        });

        const results = await prisma.$transaction(updates);

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: "BULK_PRODUCT_UPDATE",
                    entityType: "PRODUCT",
                    entityId: "multiple",
                    details: {
                        count: products.length,
                        products,
                    },
                },
            });
        }

        res.json({
            message: `${products.length} products updated successfully`,
            results,
        });
    } catch (error) {
        console.error("Bulk update products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const searchProducts = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { q, type, grade, limit = 10 } = req.query;

        if (!q) {
            res.status(400).json({ error: "Search query is required" });
            return;
        }

        const where: any = {
            OR: [
                { name: { contains: q as string, mode: "insensitive" } },
                { tireSize: { contains: q as string, mode: "insensitive" } },
                { commodity: { contains: q as string, mode: "insensitive" } },
                { originCountry: { contains: q as string, mode: "insensitive" } },
            ],
        };

        if (type) where.type = type;
        if (grade) where.grade = grade;

        // For restricted users, only search products in their store
        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';
        if (isRestrictedUser && req.user?.storeId) {
            where.inventories = {
                some: {
                    storeId: req.user.storeId
                }
            };
        }

        const products = await prisma.product.findMany({
            where,
            take: Number(limit),
            include: {
                inventories: {
                    where: isRestrictedUser && req.user?.storeId
                        ? { storeId: req.user.storeId }
                        : undefined,
                    take: 3,
                    include: {
                        store: {
                            select: {
                                id: true,
                                name: true,
                                isMainStore: true
                            }
                        },
                    },
                },
            },
            orderBy: {
                name: "asc",
            },
        });

        res.json(products);
    } catch (error) {
        console.error("Search products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// controllers/product-controller.ts - Updated getLowStockProducts


export const getLowStockProducts = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { threshold = 10 } = req.query;

        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';
        const userStoreId = req.user?.storeId;

        let where: any = {};

        // Build inventory condition based on user role
        let inventoryCondition: any = {
            quantity: {
                lte: Number(threshold),
            },
        };

        // If user is restricted (CASHIER), only show their store's low stock
        if (isRestrictedUser && userStoreId) {
            inventoryCondition.storeId = userStoreId;
            where.inventories = {
                some: inventoryCondition
            };
        } else {
            // For admins/managers, show all low stock across all stores
            where.inventories = {
                some: {
                    quantity: {
                        lte: Number(threshold),
                    },
                },
            };
        }

        const products = await prisma.product.findMany({
            where,
            include: {
                inventories: {
                    where: isRestrictedUser && userStoreId
                        ? { storeId: userStoreId }
                        : undefined,
                    include: {
                        store: {
                            select: {
                                id: true,
                                name: true,
                                isMainStore: true,
                            },
                        },
                    },
                },
            },
        });

        // Transform the response to include only low stock inventories
        const lowStockProducts = products
            .map((product) => {
                // Filter inventories that are low stock
                const lowStockInventories = product.inventories.filter(
                    (inv) => inv.quantity <= Number(threshold)
                );

                // Only include product if it has low stock inventories
                if (lowStockInventories.length === 0) {
                    return null;
                }

                return {
                    product: {
                        id: product.id,
                        name: product.name,
                        type: product.type,
                        grade: product.grade,
                        basePrice: product.basePrice,
                        commodity: product.commodity,
                    },
                    inventories: lowStockInventories.map((inv) => ({
                        storeId: inv.storeId,
                        storeName: inv.store.name,
                        isMainStore: inv.store.isMainStore,
                        quantity: inv.quantity,
                        reorderLevel: inv.reorderLevel,
                    })),
                };
            })
            .filter(Boolean); // Remove null entries

        res.json(lowStockProducts);
    } catch (error) {
        console.error("Get low stock products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
export const getProductStatisticsByCategory = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { groupBy = "type" } = req.query;

        interface CategoryStat {
            category: string;
            count: number;
            totalInventory: number;
            averagePrice: number;
            minPrice: number;
            maxPrice: number;
        }

        let result: CategoryStat[] = [];

        // For statistics, admins and managers see all, restricted users see only their store's products
        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        // Get product IDs that are in the user's store if restricted
        let productIds: string[] = [];
        if (isRestrictedUser && req.user?.storeId) {
            const inventories = await prisma.inventory.findMany({
                where: { storeId: req.user.storeId },
                select: { productId: true },
                distinct: ['productId']
            });
            productIds = inventories.map(inv => inv.productId);
        }

        const productWhere = isRestrictedUser && productIds.length > 0
            ? { id: { in: productIds } }
            : {};

        switch (groupBy) {
            case "type": {
                const types = await prisma.product.groupBy({
                    by: ["type"],
                    where: {
                        type: {
                            in: ["TIRE", "BALE"],
                        },
                        ...productWhere,
                    },
                    _count: {
                        _all: true,
                    },
                    _avg: {
                        basePrice: true,
                    },
                    _min: {
                        basePrice: true,
                    },
                    _max: {
                        basePrice: true,
                    },
                });

                for (const typeStat of types) {
                    const products = await prisma.product.findMany({
                        where: {
                            type: typeStat.type,
                            ...productWhere,
                        },
                        include: {
                            inventories: {
                                where: isRestrictedUser && req.user?.storeId
                                    ? { storeId: req.user.storeId }
                                    : undefined,
                                select: {
                                    quantity: true,
                                },
                            },
                        },
                    });

                    const totalInventory = products.reduce((sum, product) => {
                        return (
                            sum +
                            product.inventories.reduce((invSum, inv) => invSum + inv.quantity, 0)
                        );
                    }, 0);

                    result.push({
                        category: typeStat.type,
                        count: typeStat._count._all,
                        totalInventory,
                        averagePrice: typeStat._avg?.basePrice || 0,
                        minPrice: typeStat._min?.basePrice || 0,
                        maxPrice: typeStat._max?.basePrice || 0,
                    });
                }
                break;
            }

            case "grade": {
                const grades = await prisma.product.groupBy({
                    by: ["grade"],
                    where: {
                        grade: {
                            in: ["A", "B", "C"],
                        },
                        ...productWhere,
                    },
                    _count: {
                        _all: true,
                    },
                    _avg: {
                        basePrice: true,
                    },
                    _min: {
                        basePrice: true,
                    },
                    _max: {
                        basePrice: true,
                    },
                });

                for (const gradeStat of grades) {
                    const products = await prisma.product.findMany({
                        where: {
                            grade: gradeStat.grade,
                            ...productWhere,
                        },
                        include: {
                            inventories: {
                                where: isRestrictedUser && req.user?.storeId
                                    ? { storeId: req.user.storeId }
                                    : undefined,
                                select: {
                                    quantity: true,
                                },
                            },
                        },
                    });

                    const totalInventory = products.reduce((sum, product) => {
                        return (
                            sum +
                            product.inventories.reduce((invSum, inv) => invSum + inv.quantity, 0)
                        );
                    }, 0);

                    result.push({
                        category: gradeStat.grade,
                        count: gradeStat._count._all,
                        totalInventory,
                        averagePrice: gradeStat._avg?.basePrice || 0,
                        minPrice: gradeStat._min?.basePrice || 0,
                        maxPrice: gradeStat._max?.basePrice || 0,
                    });
                }
                break;
            }

            case "tireCategory": {
                const tireCategories = await prisma.product.groupBy({
                    by: ["tireCategory"],
                    where: {
                        type: "TIRE",
                        tireCategory: {
                            not: null,
                        },
                        ...productWhere,
                    },
                    _count: {
                        _all: true,
                    },
                    _avg: {
                        basePrice: true,
                    },
                    _min: {
                        basePrice: true,
                    },
                    _max: {
                        basePrice: true,
                    },
                });

                for (const categoryStat of tireCategories) {
                    const products = await prisma.product.findMany({
                        where: {
                            type: "TIRE",
                            tireCategory: categoryStat.tireCategory,
                            ...productWhere,
                        },
                        include: {
                            inventories: {
                                where: isRestrictedUser && req.user?.storeId
                                    ? { storeId: req.user.storeId }
                                    : undefined,
                                select: {
                                    quantity: true,
                                },
                            },
                        },
                    });

                    const totalInventory = products.reduce((sum, product) => {
                        return (
                            sum +
                            product.inventories.reduce((invSum, inv) => invSum + inv.quantity, 0)
                        );
                    }, 0);

                    result.push({
                        category: categoryStat.tireCategory || "Unknown",
                        count: categoryStat._count._all,
                        totalInventory,
                        averagePrice: categoryStat._avg?.basePrice || 0,
                        minPrice: categoryStat._min?.basePrice || 0,
                        maxPrice: categoryStat._max?.basePrice || 0,
                    });
                }
                break;
            }

            case "tireUsage": {
                const tireUsages = await prisma.product.groupBy({
                    by: ["tireUsage"],
                    where: {
                        type: "TIRE",
                        tireUsage: {
                            not: null,
                        },
                        ...productWhere,
                    },
                    _count: {
                        _all: true,
                    },
                    _avg: {
                        basePrice: true,
                    },
                    _min: {
                        basePrice: true,
                    },
                    _max: {
                        basePrice: true,
                    },
                });

                for (const usageStat of tireUsages) {
                    const products = await prisma.product.findMany({
                        where: {
                            type: "TIRE",
                            tireUsage: usageStat.tireUsage,
                            ...productWhere,
                        },
                        include: {
                            inventories: {
                                where: isRestrictedUser && req.user?.storeId
                                    ? { storeId: req.user.storeId }
                                    : undefined,
                                select: {
                                    quantity: true,
                                },
                            },
                        },
                    });

                    const totalInventory = products.reduce((sum, product) => {
                        return (
                            sum +
                            product.inventories.reduce((invSum, inv) => invSum + inv.quantity, 0)
                        );
                    }, 0);

                    result.push({
                        category: usageStat.tireUsage || "Unknown",
                        count: usageStat._count._all,
                        totalInventory,
                        averagePrice: usageStat._avg?.basePrice || 0,
                        minPrice: usageStat._min?.basePrice || 0,
                        maxPrice: usageStat._max?.basePrice || 0,
                    });
                }
                break;
            }

            default:
                result = [];
        }

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Get product statistics error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
        });
    }
};

export const getProductPriceStatistics = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        // For price statistics, filter by user's store if restricted
        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        let productWhere = {};
        if (isRestrictedUser && req.user?.storeId) {
            const inventories = await prisma.inventory.findMany({
                where: { storeId: req.user.storeId },
                select: { productId: true },
                distinct: ['productId']
            });
            const productIds = inventories.map(inv => inv.productId);
            productWhere = { id: { in: productIds } };
        }

        const stats = await prisma.product.aggregate({
            where: productWhere,
            _avg: {
                basePrice: true,
            },
            _min: {
                basePrice: true,
            },
            _max: {
                basePrice: true,
            },
            _count: {
                id: true,
            },
        });

        type PriceRangeRow = {
            price_range: string;
            count: bigint;
        };

        const priceRanges = await prisma.$queryRaw<PriceRangeRow[]>`
      SELECT 
        CASE 
          WHEN "basePrice" < 50 THEN '0-50'
          WHEN "basePrice" < 100 THEN '51-100'
          WHEN "basePrice" < 200 THEN '101-200'
          WHEN "basePrice" < 500 THEN '201-500'
          WHEN "basePrice" < 1000 THEN '501-1000'
          ELSE '1000+'
        END as price_range,
        COUNT(*) as count
      FROM "Product"
      ${isRestrictedUser && Object.keys(productWhere).length > 0
                ? `WHERE id IN (${(productWhere as any).id.in.map((id: string) => `'${id}'`).join(',')})`
                : ''}
      GROUP BY 
        CASE 
          WHEN "basePrice" < 50 THEN '0-50'
          WHEN "basePrice" < 100 THEN '51-100'
          WHEN "basePrice" < 200 THEN '101-200'
          WHEN "basePrice" < 500 THEN '201-500'
          WHEN "basePrice" < 1000 THEN '501-1000'
          ELSE '1000+'
        END
      ORDER BY price_range
    `;

        res.json({
            averagePrice: stats._avg.basePrice || 0,
            minPrice: stats._min.basePrice || 0,
            maxPrice: stats._max.basePrice || 0,
            totalProducts: stats._count.id || 0,
            priceRanges: priceRanges.map((range) => ({
                price_range: range.price_range,
                count: Number(range.count),
            })),
        });
    } catch (error) {
        console.error("Get price statistics error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getProductAttributes = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const [types, grades, commodities, tireCategories, tireUsages] =
            await Promise.all([
                prisma.product.findMany({
                    distinct: ["type"],
                    select: { type: true },
                }),
                prisma.product.findMany({
                    distinct: ["grade"],
                    select: { grade: true },
                }),
                prisma.product.findMany({
                    distinct: ["commodity"],
                    select: { commodity: true },
                    where: { commodity: { not: null } },
                }),
                prisma.product.findMany({
                    distinct: ["tireCategory"],
                    select: { tireCategory: true },
                    where: { tireCategory: { not: null } },
                }),
                prisma.product.findMany({
                    distinct: ["tireUsage"],
                    select: { tireUsage: true },
                    where: { tireUsage: { not: null } },
                }),
            ]);

        res.json({
            types: types.map((t) => t.type).filter(Boolean),
            grades: grades.map((g) => g.grade).filter(Boolean),
            commodities: commodities.map((c) => c.commodity).filter(Boolean),
            tireCategories: tireCategories
                .map((tc) => tc.tireCategory)
                .filter(Boolean),
            tireUsages: tireUsages.map((tu) => tu.tireUsage).filter(Boolean),
        });
    } catch (error) {
        console.error("Get product attributes error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getProductAvailability = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { productId } = req.params;

        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';

        // Get all store inventories for this product
        const inventories = await prisma.inventory.findMany({
            where: {
                productId,
                ...(isRestrictedUser && req.user?.storeId ? { storeId: req.user.storeId } : {})
            },
            include: {
                store: {
                    select: {
                        id: true,
                        name: true,
                        isMainStore: true,
                        city: true
                    }
                }
            }
        });

        // Get main store inventory
        const mainStoreInventory = inventories.find(inv => inv.store?.isMainStore);

        res.json({
            productId,
            mainStore: mainStoreInventory ? {
                storeId: mainStoreInventory.storeId,
                storeName: mainStoreInventory.store?.name,
                available: mainStoreInventory.quantity || 0
            } : null,
            branchStores: inventories
                .filter(inv => !inv.store?.isMainStore)
                .map(inv => ({
                    storeId: inv.storeId,
                    storeName: inv.store?.name,
                    available: inv.quantity,
                    city: inv.store?.city,
                    reorderLevel: inv.reorderLevel,
                    optimalLevel: inv.optimalLevel
                })),
            totalAvailable: inventories.reduce((sum, inv) => sum + inv.quantity, 0)
        });
    } catch (error) {
        console.error("Get product availability error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// controllers/product-controller.ts - Updated getProductsByStore
export const getProductsByStore = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { storeId } = req.params;
        const {
            page = 1,
            limit = 20,
            search
        } = req.query;

        console.log('🟦 getProductsByStore called with storeId:', storeId);
        console.log('🟦 User role:', req.user?.role);
        console.log('🟦 User storeId:', req.user?.storeId);

        // Validate storeId
        if (!storeId || storeId === 'undefined' || storeId === 'null') {
            console.error('🔴 Invalid store ID provided');
            res.status(400).json({
                error: "Invalid store ID",
                message: "Store ID is required and must be valid"
            });
            return;
        }

        // First verify the store exists
        const store = await prisma.store.findUnique({
            where: { id: storeId },
            select: { id: true, name: true, isMainStore: true, city: true }
        });

        if (!store) {
            console.error(`🔴 Store not found with ID: ${storeId}`);
            res.status(404).json({
                error: "Store not found",
                message: `No store found with ID: ${storeId}`
            });
            return;
        }

        console.log('🟦 Found store:', store.name);

        // Verify store access for CASHIER users
        if (req.user && req.user.role === 'CASHIER') {
            if (req.user.storeId !== storeId) {
                console.error(`🔴 Cashier ${req.user.id} attempted to access store ${storeId} but is assigned to ${req.user.storeId}`);
                res.status(403).json({
                    error: "Access denied",
                    message: "You can only view products for your assigned store"
                });
                return;
            }
        }

        const { skip, take } = generatePagination(Number(page), Number(limit));

        // Build where clause for products
        const where: any = {
            inventories: {
                some: {
                    storeId: storeId
                }
            }
        };

        // Add search filter if provided
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { commodity: { contains: search as string, mode: 'insensitive' } },
                { tireSize: { contains: search as string, mode: 'insensitive' } },
                { description: { contains: search as string, mode: 'insensitive' } },
            ];
        }

        console.log('🟦 Query where clause:', JSON.stringify(where, null, 2));

        // Get products and total count
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip,
                take,
                include: {
                    inventories: {
                        where: {
                            storeId: storeId
                        },
                        include: {
                            store: {
                                select: {
                                    id: true,
                                    name: true,
                                    isMainStore: true,
                                    city: true
                                }
                            }
                        }
                    }
                },
                orderBy: { name: 'asc' }
            }),
            prisma.product.count({ where })
        ]);

        console.log(`🟦 Found ${products.length} products for store ${store.name}`);

        // Format response with proper inventory structure
        const formattedProducts = products.map((product: any) => {
            // Get the inventory for this specific store (should be the first/only one)
            const storeInventory = product.inventories[0];

            // Default values if no inventory found
            const inventory = storeInventory ? {
                storeId: storeInventory.storeId,
                storeName: storeInventory.store?.name || 'Unknown Store',
                storeType: storeInventory.store?.isMainStore ? 'MAIN' : 'BRANCH',
                quantity: storeInventory.quantity || 0,
                reorderLevel: storeInventory.reorderLevel,
                optimalLevel: storeInventory.optimalLevel,
                storePrice: storeInventory.storePrice,
                value: (storeInventory.storePrice || product.basePrice) * (storeInventory.quantity || 0),
                lastUpdated: storeInventory.updatedAt
            } : {
                storeId: storeId,
                storeName: store.name,
                storeType: store.isMainStore ? 'MAIN' : 'BRANCH',
                quantity: 0,
                reorderLevel: null,
                optimalLevel: null,
                storePrice: null,
                value: 0,
                lastUpdated: new Date()
            };

            return {
                id: product.id,
                name: product.name,
                description: product.description,
                basePrice: product.basePrice,
                type: product.type,
                grade: product.grade,
                commodity: product.commodity,
                tireCategory: product.tireCategory,
                tireUsage: product.tireUsage,
                tireSize: product.tireSize,
                loadIndex: product.loadIndex,
                speedRating: product.speedRating,
                warrantyPeriod: product.warrantyPeriod,
                baleWeight: product.baleWeight,
                baleCategory: product.baleCategory,
                originCountry: product.originCountry,
                importDate: product.importDate,
                isActive: product.isActive,
                rating: product.rating,
                reviewCount: product.reviewCount,
                createdAt: product.createdAt,
                updatedAt: product.updatedAt,
                inventory: inventory,
                // Keep original inventories array for backward compatibility
                inventories: product.inventories
            };
        });

        // Get store info with more details
        const storeInfo = {
            id: store.id,
            name: store.name,
            isMainStore: store.isMainStore,
            city: store.city
        };

        // Generate meta information
        const meta = {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
            hasNextPage: Number(page) < Math.ceil(total / Number(limit)),
            hasPrevPage: Number(page) > 1
        };

        console.log(`🟦 Successfully formatted ${formattedProducts.length} products for response`);

        res.json({
            success: true,
            data: formattedProducts,
            meta: meta,
            storeInfo: storeInfo
        });

    } catch (error) {
        console.error("🔴 Get products by store error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error occurred"
        });
    }
};

export const getProductsWithInventory = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            type,
            grade,
            minPrice,
            maxPrice,
            minStock,
            maxStock
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        const where: any = {};

        // Search filter
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { commodity: { contains: search as string, mode: 'insensitive' } },
                { tireSize: { contains: search as string, mode: 'insensitive' } },
            ];
        }

        // Product filters
        if (type) where.type = type;
        if (grade) where.grade = grade;
        if (minPrice || maxPrice) {
            where.basePrice = {};
            if (minPrice) where.basePrice.gte = Number(minPrice);
            if (maxPrice) where.basePrice.lte = Number(maxPrice);
        }

        // For restricted users, filter by their store
        const isRestrictedUser = req.user && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER';
        if (isRestrictedUser && req.user?.storeId) {
            where.inventories = {
                some: {
                    storeId: req.user.storeId
                }
            };
        }

        // First get products
        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip,
                take,
                include: {
                    inventories: {
                        where: isRestrictedUser && req.user?.storeId
                            ? { storeId: req.user.storeId }
                            : undefined,
                        include: {
                            store: {
                                select: {
                                    id: true,
                                    name: true,
                                    isMainStore: true,
                                    city: true
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.product.count({ where })
        ]);

        // Calculate inventory summary for each product
        const productsWithInventory = (products as ProductWithInventories[]).map(product => {
            const totalInventory = product.inventories.reduce(
                (sum: number, inv: InventoryWithStore) => sum + inv.quantity,
                0
            );

            const mainStoreInventory = product.inventories.find(
                (inv: InventoryWithStore) => inv.store?.isMainStore
            )?.quantity || 0;

            const branchInventory = totalInventory - mainStoreInventory;

            // Calculate inventory by store
            const inventoryByStore = product.inventories.map((inv: InventoryWithStore) => ({
                storeId: inv.storeId,
                storeName: inv.store?.name,
                storeType: inv.store?.isMainStore ? 'MAIN' : 'BRANCH',
                quantity: inv.quantity,
                reorderLevel: inv.reorderLevel,
                optimalLevel: inv.optimalLevel,
                storePrice: inv.storePrice,
                lastUpdated: inv.updatedAt
            }));

            return {
                ...product,
                inventory: {
                    total: totalInventory,
                    mainStore: mainStoreInventory,
                    branches: branchInventory,
                    byStore: inventoryByStore
                }
            };
        });

        // Filter by stock levels if specified
        let filteredProducts = productsWithInventory;
        if (minStock !== undefined) {
            filteredProducts = filteredProducts.filter(
                p => p.inventory.total >= Number(minStock)
            );
        }
        if (maxStock !== undefined) {
            filteredProducts = filteredProducts.filter(
                p => p.inventory.total <= Number(maxStock)
            );
        }

        // Calculate summary statistics
        const summary = {
            totalProducts: filteredProducts.length,
            totalInventoryValue: filteredProducts.reduce((sum, product) => {
                return sum + (product.basePrice * product.inventory.total);
            }, 0),
            totalItemsInStock: filteredProducts.reduce((sum, product) => {
                return sum + product.inventory.total;
            }, 0),
            lowStockItems: filteredProducts.filter(product => {
                const hasLowStock = product.inventories.some((inv: InventoryWithStore) =>
                    inv.quantity < (inv.reorderLevel || 10)
                );
                return hasLowStock;
            }).length
        };

        res.json({
            data: filteredProducts,
            summary,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get products with inventory error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};