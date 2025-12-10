// controllers/product.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';

export class ProductController extends BaseController {
    // Create product
    async createProduct(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                name,
                price,
                quantity,
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
                baleCount
            } = req.body;

            // Determine storeId
            let storeId = req.body.storeId;
            if (user.role !== 'ADMIN' && !storeId) {
                storeId = user.storeId;
            }

            if (!storeId) {
                return res.status(400).json({ error: 'Store ID is required' });
            }

            // Verify store exists and user has access
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }

            if (user.role !== 'ADMIN' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }

            // Create product
            const product = await prisma.product.create({
                data: {
                    name,
                    price: parseFloat(price),
                    quantity: parseInt(quantity),
                    type,
                    grade,
                    commodity,
                    storeId,

                    // Tire fields
                    tireCategory: type === 'TIRE' ? tireCategory : null,
                    tireUsage: type === 'TIRE' ? tireUsage : null,
                    tireSize: type === 'TIRE' ? tireSize : null,
                    loadIndex: type === 'TIRE' ? loadIndex : null,
                    speedRating: type === 'TIRE' ? speedRating : null,
                    warrantyPeriod: type === 'TIRE' ? warrantyPeriod : null,

                    // Bale fields
                    baleWeight: type === 'BALE' ? parseFloat(baleWeight || '0') : null,
                    baleCategory: type === 'BALE' ? baleCategory : null,
                    originCountry: type === 'BALE' ? originCountry : null,
                    importDate: type === 'BALE' && importDate ? new Date(importDate) : null,
                    baleCount: type === 'BALE' ? parseInt(baleCount || '0') : null
                },
                include: {
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                }
            });

            res.status(201).json({
                message: 'Product created successfully',
                product
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to create product');
        }
    }

    // Get all products (with store filtering)
    async getProducts(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                storeId,
                type,
                category,
                search,
                page = 1,
                limit = 20,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            // Build where clause
            let where: any = this.filterByStore(user.role, user.storeId);

            if (storeId && user.role === 'ADMIN') {
                where.storeId = storeId as string;
            }

            if (type) {
                where.type = type;
            }

            if (category && where.type === 'TIRE') {
                where.tireCategory = category;
            }

            if (search) {
                where.OR = [
                    { name: { contains: search as string, mode: 'insensitive' } },
                    { commodity: { contains: search as string, mode: 'insensitive' } },
                    { tireSize: { contains: search as string, mode: 'insensitive' } },
                    { baleCategory: { contains: search as string, mode: 'insensitive' } }
                ];
            }

            // Get products with pagination
            const [products, total] = await Promise.all([
                prisma.product.findMany({
                    where,
                    include: {
                        store: {
                            select: {
                                name: true,
                                location: true
                            }
                        }
                    },
                    orderBy: { [sortBy as string]: sortOrder },
                    skip,
                    take: limitNum
                }),
                prisma.product.count({ where })
            ]);

            res.json({
                products,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get products');
        }
    }

    // Get product by ID
    async getProductById(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            const product = await prisma.product.findUnique({
                where: { id },
                include: {
                    store: true,
                    saleItems: {
                        include: {
                            sale: {
                                include: {
                                    employee: true
                                }
                            }
                        },
                        orderBy: {
                            sale: {
                                createdAt: 'desc'
                            }
                        },
                        take: 10
                    }
                }
            });

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Check access
            if (user.role !== 'ADMIN' && user.storeId !== product.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }

            res.json(product);
        } catch (error) {
            this.handleError(res, error, 'Failed to get product');
        }
    }

    // Update product
    async updateProduct(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;
            const updateData = req.body;

            // Check if product exists and user has access
            const existingProduct = await prisma.product.findUnique({
                where: { id },
                include: { store: true }
            });

            if (!existingProduct) {
                return res.status(404).json({ error: 'Product not found' });
            }

            if (user.role !== 'ADMIN' && user.storeId !== existingProduct.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }

            // Convert numeric fields
            if (updateData.price) updateData.price = parseFloat(updateData.price);
            if (updateData.quantity) updateData.quantity = parseInt(updateData.quantity);
            if (updateData.baleWeight) updateData.baleWeight = parseFloat(updateData.baleWeight);
            if (updateData.baleCount) updateData.baleCount = parseInt(updateData.baleCount);
            if (updateData.importDate) updateData.importDate = new Date(updateData.importDate);

            const updatedProduct = await prisma.product.update({
                where: { id },
                data: updateData,
                include: {
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                }
            });

            res.json({
                message: 'Product updated successfully',
                product: updatedProduct
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to update product');
        }
    }

    // Delete product
    async deleteProduct(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            // Check if product exists and user has access
            const product = await prisma.product.findUnique({
                where: { id }
            });

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            if (user.role !== 'ADMIN' && user.storeId !== product.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }

            // Check if product has sales
            const saleItems = await prisma.saleItem.count({
                where: { productId: id }
            });

            if (saleItems > 0) {
                return res.status(400).json({
                    error: 'Cannot delete product with sales history. Use soft delete or archive instead.'
                });
            }

            await prisma.product.delete({
                where: { id }
            });

            res.json({ message: 'Product deleted successfully' });
        } catch (error) {
            this.handleError(res, error, 'Failed to delete product');
        }
    }

    // Update product quantity (for inventory management)
    async updateQuantity(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;
            const { quantity, operation = 'SET' } = req.body; // operation: SET, ADD, SUBTRACT

            // Check if product exists and user has access
            const product = await prisma.product.findUnique({
                where: { id }
            });

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            if (user.role !== 'ADMIN' && user.storeId !== product.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }

            let newQuantity = product.quantity;
            switch (operation) {
                case 'SET':
                    newQuantity = parseInt(quantity);
                    break;
                case 'ADD':
                    newQuantity = product.quantity + parseInt(quantity);
                    break;
                case 'SUBTRACT':
                    newQuantity = product.quantity - parseInt(quantity);
                    if (newQuantity < 0) {
                        return res.status(400).json({ error: 'Insufficient stock' });
                    }
                    break;
                default:
                    return res.status(400).json({ error: 'Invalid operation' });
            }

            const updatedProduct = await prisma.product.update({
                where: { id },
                data: { quantity: newQuantity }
            });

            // Log inventory change
            await prisma.activityLog.create({
                data: {
                    userId: user.id,
                    action: 'UPDATE_QUANTITY',
                    entityType: 'PRODUCT',
                    entityId: id,
                    details: {
                        oldQuantity: product.quantity,
                        newQuantity,
                        operation,
                        changedBy: user.email
                    }
                }
            });

            res.json({
                message: 'Quantity updated successfully',
                product: updatedProduct
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to update quantity');
        }
    }

    // Get low stock products
    async getLowStock(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { threshold = 10 } = req.query;

            const where = {
                ...this.filterByStore(user.role, user.storeId),
                quantity: { lte: parseInt(threshold as string) }
            };

            const lowStockProducts = await prisma.product.findMany({
                where,
                include: {
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                },
                orderBy: {
                    quantity: 'asc'
                }
            });

            res.json(lowStockProducts);
        } catch (error) {
            this.handleError(res, error, 'Failed to get low stock products');
        }
    }

    // Transfer product between stores (Admin/Manager)
    async transferProduct(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { productId, fromStoreId, toStoreId, quantity } = req.body;

            // Check permissions
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            if (user.role === 'MANAGER') {
                if (user.storeId !== fromStoreId && user.storeId !== toStoreId) {
                    return res.status(403).json({ error: 'Can only transfer from/to your store' });
                }
            }

            // Start transaction
            const result = await prisma.$transaction(async (tx: { product: { findUnique: (arg0: { where: { id_storeId: { id: any; storeId: any; }; } | { id_storeId: { id: any; storeId: any; }; }; }) => any; update: (arg0: { where: { id_storeId: { id: any; storeId: any; }; } | { id_storeId: { id: any; storeId: any; }; }; data: { quantity: number; } | { quantity: any; }; }) => any; create: (arg0: { data: any; }) => any; }; productTransfer: { create: (arg0: { data: { productId: any; fromStoreId: any; toStoreId: any; quantity: number; transferredBy: string; status: string; }; }) => any; }; }) => {
                // Check source product
                const sourceProduct = await tx.product.findUnique({
                    where: {
                        id_storeId: {
                            id: productId,
                            storeId: fromStoreId
                        }
                    }
                });

                if (!sourceProduct) {
                    throw new Error('Product not found in source store');
                }

                if (sourceProduct.quantity < parseInt(quantity)) {
                    throw new Error('Insufficient stock in source store');
                }

                // Update source product quantity
                await tx.product.update({
                    where: {
                        id_storeId: {
                            id: productId,
                            storeId: fromStoreId
                        }
                    },
                    data: {
                        quantity: sourceProduct.quantity - parseInt(quantity)
                    }
                });

                // Check if product exists in destination store
                let destinationProduct = await tx.product.findUnique({
                    where: {
                        id_storeId: {
                            id: productId,
                            storeId: toStoreId
                        }
                    }
                });

                if (destinationProduct) {
                    // Update existing product
                    destinationProduct = await tx.product.update({
                        where: {
                            id_storeId: {
                                id: productId,
                                storeId: toStoreId
                            }
                        },
                        data: {
                            quantity: destinationProduct.quantity + parseInt(quantity)
                        }
                    });
                } else {
                    // Create new product in destination store
                    const { id, storeId, createdAt, updatedAt, ...productData } = sourceProduct;
                    destinationProduct = await tx.product.create({
                        data: {
                            ...productData,
                            id: productId, // Keep same product ID
                            storeId: toStoreId,
                            quantity: parseInt(quantity)
                        }
                    });
                }

                // Create transfer record
                const transfer = await tx.productTransfer.create({
                    data: {
                        productId,
                        fromStoreId,
                        toStoreId,
                        quantity: parseInt(quantity),
                        transferredBy: user.id,
                        status: 'COMPLETED'
                    }
                });

                return { sourceProduct, destinationProduct, transfer };
            });

            res.json({
                message: 'Product transferred successfully',
                ...result
            });
        } catch (error: any) {
            this.handleError(res, error, error.message || 'Failed to transfer product');
        }
    }
}