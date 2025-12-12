"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
class ProductController extends base_controller_1.BaseController {
    async createProduct(req, res) {
        try {
            const user = req.user;
            const { name, price, quantity, type, grade, commodity, tireCategory, tireUsage, tireSize, loadIndex, speedRating, warrantyPeriod, baleWeight, baleCategory, originCountry, importDate, baleCount } = req.body;
            let storeId = req.body.storeId;
            if (user.role !== 'ADMIN' && !storeId) {
                storeId = user.storeId;
            }
            if (!storeId) {
                return res.status(400).json({ error: 'Store ID is required' });
            }
            const store = await prisma_1.prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }
            if (user.role !== 'ADMIN' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }
            const product = await prisma_1.prisma.product.create({
                data: {
                    name,
                    price: parseFloat(price),
                    quantity: parseInt(quantity),
                    type,
                    grade,
                    commodity,
                    storeId,
                    tireCategory: type === 'TIRE' ? tireCategory : null,
                    tireUsage: type === 'TIRE' ? tireUsage : null,
                    tireSize: type === 'TIRE' ? tireSize : null,
                    loadIndex: type === 'TIRE' ? loadIndex : null,
                    speedRating: type === 'TIRE' ? speedRating : null,
                    warrantyPeriod: type === 'TIRE' ? warrantyPeriod : null,
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to create product');
        }
    }
    async getProducts(req, res) {
        try {
            const user = req.user;
            const { storeId, type, category, search, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            let where = this.filterByStore(user.role, user.storeId);
            if (storeId && user.role === 'ADMIN') {
                where.storeId = storeId;
            }
            if (type) {
                where.type = type;
            }
            if (category && where.type === 'TIRE') {
                where.tireCategory = category;
            }
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { commodity: { contains: search, mode: 'insensitive' } },
                    { tireSize: { contains: search, mode: 'insensitive' } },
                    { baleCategory: { contains: search, mode: 'insensitive' } }
                ];
            }
            const [products, total] = await Promise.all([
                prisma_1.prisma.product.findMany({
                    where,
                    include: {
                        store: {
                            select: {
                                name: true,
                                location: true
                            }
                        }
                    },
                    orderBy: { [sortBy]: sortOrder },
                    skip,
                    take: limitNum
                }),
                prisma_1.prisma.product.count({ where })
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get products');
        }
    }
    async getProductById(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const product = await prisma_1.prisma.product.findUnique({
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
            if (user.role !== 'ADMIN' && user.storeId !== product.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }
            res.json(product);
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get product');
        }
    }
    async updateProduct(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const updateData = req.body;
            const existingProduct = await prisma_1.prisma.product.findUnique({
                where: { id },
                include: { store: true }
            });
            if (!existingProduct) {
                return res.status(404).json({ error: 'Product not found' });
            }
            if (user.role !== 'ADMIN' && user.storeId !== existingProduct.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }
            if (updateData.price)
                updateData.price = parseFloat(updateData.price);
            if (updateData.quantity)
                updateData.quantity = parseInt(updateData.quantity);
            if (updateData.baleWeight)
                updateData.baleWeight = parseFloat(updateData.baleWeight);
            if (updateData.baleCount)
                updateData.baleCount = parseInt(updateData.baleCount);
            if (updateData.importDate)
                updateData.importDate = new Date(updateData.importDate);
            const updatedProduct = await prisma_1.prisma.product.update({
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to update product');
        }
    }
    async deleteProduct(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const product = await prisma_1.prisma.product.findUnique({
                where: { id }
            });
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }
            if (user.role !== 'ADMIN' && user.storeId !== product.storeId) {
                return res.status(403).json({ error: 'Access denied to this product' });
            }
            const saleItems = await prisma_1.prisma.saleItem.count({
                where: { productId: id }
            });
            if (saleItems > 0) {
                return res.status(400).json({
                    error: 'Cannot delete product with sales history. Use soft delete or archive instead.'
                });
            }
            await prisma_1.prisma.product.delete({
                where: { id }
            });
            res.json({ message: 'Product deleted successfully' });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to delete product');
        }
    }
    async updateQuantity(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { quantity, operation = 'SET' } = req.body;
            const product = await prisma_1.prisma.product.findUnique({
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
            const updatedProduct = await prisma_1.prisma.product.update({
                where: { id },
                data: { quantity: newQuantity }
            });
            await prisma_1.prisma.activityLog.create({
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to update quantity');
        }
    }
    async getLowStock(req, res) {
        try {
            const user = req.user;
            const { threshold = 10 } = req.query;
            const where = {
                ...this.filterByStore(user.role, user.storeId),
                quantity: { lte: parseInt(threshold) }
            };
            const lowStockProducts = await prisma_1.prisma.product.findMany({
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get low stock products');
        }
    }
    async transferProduct(req, res) {
        try {
            const user = req.user;
            const { productId, fromStoreId, toStoreId, quantity } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            if (user.role === 'MANAGER') {
                if (user.storeId !== fromStoreId && user.storeId !== toStoreId) {
                    return res.status(403).json({ error: 'Can only transfer from/to your store' });
                }
            }
            const result = await prisma_1.prisma.$transaction(async (tx) => {
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
                let destinationProduct = await tx.product.findUnique({
                    where: {
                        id_storeId: {
                            id: productId,
                            storeId: toStoreId
                        }
                    }
                });
                if (destinationProduct) {
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
                }
                else {
                    const { id, storeId, createdAt, updatedAt, ...productData } = sourceProduct;
                    destinationProduct = await tx.product.create({
                        data: {
                            ...productData,
                            id: productId,
                            storeId: toStoreId,
                            quantity: parseInt(quantity)
                        }
                    });
                }
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
        }
        catch (error) {
            this.handleError(res, error, error.message || 'Failed to transfer product');
        }
    }
}
exports.ProductController = ProductController;
//# sourceMappingURL=product-controller.js.map