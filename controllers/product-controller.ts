import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ProductType, TireCategory, TireUsage, ProductGrade } from "@prisma/client";

interface ProductRequest extends Request {
    body: {
        name: string;
        price: number;
        quantity: number;
        type: ProductType;
        grade: ProductGrade;
        storeId: string;
        commodity?: string;

        // Tire-specific fields
        tireCategory?: TireCategory;
        tireUsage?: TireUsage;
        tireSize?: string;
        loadIndex?: string;
        speedRating?: string;
        warrantyPeriod?: string;

        // Bale-specific fields
        baleWeight?: number;
        baleCategory?: string;
        originCountry?: string;
        importDate?: string;
        baleCount?: number;
    };
}

// CREATE PRODUCT
export const createProduct = async (req: ProductRequest, res: Response) => {
    try {
        const {
            name, price, quantity, type, grade, storeId, commodity,
            tireCategory, tireUsage, tireSize, loadIndex, speedRating, warrantyPeriod,
            baleWeight, baleCategory, originCountry, importDate, baleCount
        } = req.body;

        // Validation
        if (!name || !price || quantity === undefined || !type || !grade || !storeId) {
            return res.status(400).json({ error: "Required fields: name, price, quantity, type, grade, storeId" });
        }

        if (price <= 0 || quantity < 0) {
            return res.status(400).json({ error: "Price must be positive and quantity must be non-negative" });
        }

        // Check if store exists
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) return res.status(400).json({ error: "Store not found" });

        // Type-specific validation
        if (type === ProductType.TIRE) {
            if (!tireCategory || !tireUsage || !tireSize) {
                return res.status(400).json({
                    error: "Tire products require: tireCategory, tireUsage, tireSize"
                });
            }
        } else if (type === ProductType.BALE) {
            if (!baleWeight || !baleCategory) {
                return res.status(400).json({
                    error: "Bale products require: baleWeight, baleCategory"
                });
            }
        }

        const productData: any = {
            name,
            price,
            quantity,
            type,
            grade,
            storeId,
            commodity,
        };

        // Add tire-specific fields
        if (type === ProductType.TIRE) {
            productData.tireCategory = tireCategory;
            productData.tireUsage = tireUsage;
            productData.tireSize = tireSize;
            if (loadIndex) productData.loadIndex = loadIndex;
            if (speedRating) productData.speedRating = speedRating;
            if (warrantyPeriod) productData.warrantyPeriod = warrantyPeriod;
        }

        // Add bale-specific fields
        if (type === ProductType.BALE) {
            productData.baleWeight = baleWeight;
            productData.baleCategory = baleCategory;
            if (originCountry) productData.originCountry = originCountry;
            if (importDate) productData.importDate = new Date(importDate);
            if (baleCount) productData.baleCount = baleCount;
        }

        const product = await prisma.product.create({
            data: productData,
            include: {
                store: { select: { name: true, location: true } },
            },
        });

        res.status(201).json({
            message: "Product created successfully",
            product,
        });
    } catch (error) {
        console.error("Product creation error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET ALL PRODUCTS
export const getProducts = async (req: Request, res: Response) => {
    try {
        const {
            storeId, type, grade, tireCategory, tireUsage,
            minPrice, maxPrice, inStock, search
        } = req.query;

        const where: any = {};

        if (storeId) where.storeId = storeId as string;
        if (type) where.type = type as ProductType;
        if (grade) where.grade = grade as ProductGrade;
        if (tireCategory) where.tireCategory = tireCategory as TireCategory;
        if (tireUsage) where.tireUsage = tireUsage as TireUsage;

        if (minPrice || maxPrice) {
            where.price = {};
            if (minPrice) where.price.gte = parseFloat(minPrice as string);
            if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
        }

        if (inStock === 'true') where.quantity = { gt: 0 };
        if (inStock === 'false') where.quantity = { lte: 0 };

        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { commodity: { contains: search as string, mode: 'insensitive' } },
                { tireSize: { contains: search as string, mode: 'insensitive' } },
            ];
        }

        const products = await prisma.product.findMany({
            where,
            include: {
                store: { select: { id: true, name: true, location: true } },
                _count: { select: { SaleItem: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json({ products });
    } catch (error) {
        console.error("Get products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET PRODUCT BY ID
export const getProductById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                store: { select: { id: true, name: true, location: true } },
                SaleItem: {
                    take: 10,
                    orderBy: { sale: { createdAt: "desc" } },
                    select: {
                        quantity: true,
                        price: true,
                        sale: {
                            select: {
                                id: true,
                                createdAt: true,
                                employee: {
                                    select: { firstName: true, lastName: true },
                                },
                            },
                        },
                    },
                },
                _count: { select: { SaleItem: true } },
            },
        });

        if (!product) return res.status(404).json({ error: "Product not found" });

        res.json({ product });
    } catch (error) {
        console.error("Get product error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// UPDATE PRODUCT
export const updateProduct = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const product = await prisma.product.findUnique({ where: { id } });
        if (!product) return res.status(404).json({ error: "Product not found" });

        // Validation for updated fields
        if (updateData.price !== undefined && updateData.price <= 0) {
            return res.status(400).json({ error: "Price must be positive" });
        }

        if (updateData.quantity !== undefined && updateData.quantity < 0) {
            return res.status(400).json({ error: "Quantity must be non-negative" });
        }

        if (updateData.storeId) {
            const store = await prisma.store.findUnique({ where: { id: updateData.storeId } });
            if (!store) return res.status(400).json({ error: "Store not found" });
        }

        // Handle importDate conversion if provided
        if (updateData.importDate) {
            updateData.importDate = new Date(updateData.importDate);
        }

        const updatedProduct = await prisma.product.update({
            where: { id },
            data: updateData,
            include: {
                store: { select: { name: true, location: true } },
            },
        });

        res.json({
            message: "Product updated successfully",
            product: updatedProduct,
        });
    } catch (error) {
        console.error("Update product error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// DELETE PRODUCT
export const deleteProduct = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                _count: { select: { SaleItem: true } },
            },
        });

        if (!product) return res.status(404).json({ error: "Product not found" });

        // Check if product has sales records
        if (product._count.SaleItem > 0) {
            return res.status(400).json({
                error: "Cannot delete product with existing sales records"
            });
        }

        await prisma.product.delete({ where: { id } });

        res.json({ message: "Product deleted successfully" });
    } catch (error) {
        console.error("Delete product error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// UPDATE PRODUCT QUANTITY (for inventory management)
export const updateProductQuantity = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { quantity, operation } = req.body; // operation: 'add', 'subtract', 'set'

        if (!quantity || quantity < 0) {
            return res.status(400).json({ error: "Quantity must be a positive number" });
        }

        if (!operation || !['add', 'subtract', 'set'].includes(operation)) {
            return res.status(400).json({ error: "Operation must be 'add', 'subtract', or 'set'" });
        }

        const product = await prisma.product.findUnique({ where: { id } });
        if (!product) return res.status(404).json({ error: "Product not found" });

        let newQuantity: number;
        switch (operation) {
            case 'add':
                newQuantity = product.quantity + quantity;
                break;
            case 'subtract':
                newQuantity = Math.max(0, product.quantity - quantity);
                break;
            case 'set':
                newQuantity = quantity;
                break;
            default:
                return res.status(400).json({ error: "Invalid operation" });
        }

        const updatedProduct = await prisma.product.update({
            where: { id },
            data: { quantity: newQuantity },
            include: {
                store: { select: { name: true, location: true } },
            },
        });

        res.json({
            message: `Product quantity ${operation}ed successfully`,
            product: updatedProduct,
            previousQuantity: product.quantity,
            newQuantity,
        });
    } catch (error) {
        console.error("Update product quantity error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET LOW STOCK PRODUCTS
export const getLowStockProducts = async (req: Request, res: Response) => {
    try {
        const { storeId, threshold = 5 } = req.query;

        const where: any = {
            quantity: { lte: parseInt(threshold as string) },
        };
        if (storeId) where.storeId = storeId as string;

        const products = await prisma.product.findMany({
            where,
            include: {
                store: { select: { id: true, name: true, location: true } },
            },
            orderBy: { quantity: "asc" },
        });

        res.json({
            products,
            threshold: parseInt(threshold as string),
            count: products.length
        });
    } catch (error) {
        console.error("Get low stock products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET PRODUCT ANALYTICS
export const getProductAnalytics = async (req: Request, res: Response) => {
    try {
        const { storeId, startDate, endDate } = req.query;

        const storeFilter = storeId ? { storeId: storeId as string } : {};
        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter.sale = {
                createdAt: {
                    gte: new Date(startDate as string),
                    lte: new Date(endDate as string),
                },
            };
        }

        const [
            totalProducts,
            totalValue,
            lowStockCount,
            outOfStockCount,
            topSellingProducts,
            productsByType,
            productsByGrade
        ] = await Promise.all([
            // Total products
            prisma.product.count({ where: storeFilter }),

            // Total inventory value
            prisma.product.aggregate({
                where: storeFilter,
                _sum: {
                    quantity: true,
                },
            }).then(async (result) => {
                const products = await prisma.product.findMany({
                    where: storeFilter,
                    select: { quantity: true, price: true },
                });
                return products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
            }),

            // Low stock count (≤ 5)
            prisma.product.count({
                where: { ...storeFilter, quantity: { lte: 5 } },
            }),

            // Out of stock count
            prisma.product.count({
                where: { ...storeFilter, quantity: 0 },
            }),

            // Top selling products
            prisma.saleItem.groupBy({
                by: ["productId"],
                where: {
                    product: storeFilter,
                    ...dateFilter,
                },
                _sum: { quantity: true },
                _count: true,
                orderBy: { _sum: { quantity: "desc" } },
                take: 10,
            }),

            // Products by type
            prisma.product.groupBy({
                by: ["type"],
                where: storeFilter,
                _count: true,
                _sum: { quantity: true },
            }),

            // Products by grade
            prisma.product.groupBy({
                by: ["grade"],
                where: storeFilter,
                _count: true,
                _sum: { quantity: true },
            }),
        ]);

        // Get product details for top selling
        const productIds = topSellingProducts.map(item => item.productId);
        const topProducts = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, type: true, price: true },
        });

        const analytics = {
            overview: {
                totalProducts,
                totalValue,
                lowStockCount,
                outOfStockCount,
            },
            topSellingProducts: topSellingProducts.map(item => {
                const product = topProducts.find(p => p.id === item.productId);
                return {
                    product,
                    quantitySold: item._sum.quantity,
                    salesCount: item._count,
                };
            }),
            distribution: {
                byType: productsByType,
                byGrade: productsByGrade,
            },
        };

        res.json({ analytics });
    } catch (error) {
        console.error("Get product analytics error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// BULK UPDATE PRODUCTS
export const bulkUpdateProducts = async (req: Request, res: Response) => {
    try {
        const { productIds, updates } = req.body;

        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: "Product IDs array is required" });
        }

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: "Updates object is required" });
        }

        // Validation for bulk updates
        if (updates.price !== undefined && updates.price <= 0) {
            return res.status(400).json({ error: "Price must be positive" });
        }

        if (updates.quantity !== undefined && updates.quantity < 0) {
            return res.status(400).json({ error: "Quantity must be non-negative" });
        }

        const updatedProducts = await prisma.product.updateMany({
            where: { id: { in: productIds } },
            data: updates,
        });

        res.json({
            message: `${updatedProducts.count} products updated successfully`,
            updatedCount: updatedProducts.count,
        });
    } catch (error) {
        console.error("Bulk update products error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};