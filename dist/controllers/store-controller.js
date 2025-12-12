"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
class StoreController extends base_controller_1.BaseController {
    async createStore(req, res) {
        try {
            const user = req.user;
            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can create stores' });
            }
            const { name, location } = req.body;
            const store = await prisma_1.prisma.store.create({
                data: { name, location }
            });
            res.status(201).json({
                message: 'Store created successfully',
                store
            });
        }
        catch (error) {
            console.log(error);
        }
    }
    async getStores(req, res) {
        try {
            const user = req.user;
            let stores;
            if (user.role === 'ADMIN') {
                stores = await prisma_1.prisma.store.findMany({
                    include: {
                        _count: {
                            select: {
                                employees: true,
                                products: true,
                                sales: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                });
            }
            else {
                stores = await prisma_1.prisma.store.findMany({
                    where: { id: user.storeId },
                    include: {
                        _count: {
                            select: {
                                employees: true,
                                products: true,
                                sales: true
                            }
                        }
                    }
                });
            }
            res.json(stores);
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get stores');
        }
    }
    async getStoreById(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }
            const store = await prisma_1.prisma.store.findUnique({
                where: { id },
                include: {
                    employees: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    email: true,
                                    role: true,
                                    emailVerified: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            products: true,
                            sales: true
                        }
                    }
                }
            });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }
            res.json(store);
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get store');
        }
    }
    async updateStore(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can update stores' });
            }
            const { name, location } = req.body;
            const updatedStore = await prisma_1.prisma.store.update({
                where: { id },
                data: { name, location }
            });
            res.json({
                message: 'Store updated successfully',
                store: updatedStore
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to update store');
        }
    }
    async deleteStore(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can delete stores' });
            }
            const store = await prisma_1.prisma.store.findUnique({
                where: { id },
                include: {
                    _count: {
                        select: {
                            employees: true,
                            products: true,
                            sales: true
                        }
                    }
                }
            });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }
            if (store._count.employees > 0 || store._count.products > 0) {
                return res.status(400).json({
                    error: 'Cannot delete store with employees or products. Remove them first.'
                });
            }
            await prisma_1.prisma.store.delete({
                where: { id }
            });
            res.json({ message: 'Store deleted successfully' });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to delete store');
        }
    }
    async getStoreStats(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }
            const [stats, recentSales, topProducts, lowStock] = await Promise.all([
                prisma_1.prisma.store.findUnique({
                    where: { id },
                    select: {
                        _count: {
                            select: {
                                employees: true,
                                products: true,
                                sales: true
                            }
                        }
                    }
                }),
                prisma_1.prisma.sale.findMany({
                    where: { storeId: id },
                    include: {
                        employee: {
                            include: {
                                user: {
                                    select: {
                                        firstName: true,
                                        lastName: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }),
                prisma_1.prisma.saleItem.groupBy({
                    by: ['productId'],
                    where: {
                        sale: { storeId: id }
                    },
                    _sum: {
                        quantity: true
                    },
                    orderBy: {
                        _sum: {
                            quantity: 'desc'
                        }
                    },
                    take: 5
                }),
                prisma_1.prisma.product.findMany({
                    where: {
                        storeId: id,
                        quantity: { lte: 10 }
                    },
                    orderBy: { quantity: 'asc' },
                    take: 10
                })
            ]);
            const topProductsWithDetails = await Promise.all(topProducts.map(async (item) => {
                const product = await prisma_1.prisma.product.findUnique({
                    where: { id: item.productId },
                    select: {
                        name: true,
                        price: true,
                        quantity: true,
                        type: true
                    }
                });
                return {
                    ...item,
                    productName: product?.name,
                    currentPrice: product?.price,
                    currentStock: product?.quantity,
                    type: product?.type
                };
            }));
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const salesSummary = await prisma_1.prisma.sale.aggregate({
                where: {
                    storeId: id,
                    createdAt: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
            res.json({
                stats: {
                    employeeCount: stats?._count.employees || 0,
                    productCount: stats?._count.products || 0,
                    saleCount: stats?._count.sales || 0
                },
                salesSummary: {
                    totalRevenue: salesSummary._sum.total || 0,
                    totalSales: salesSummary._count,
                    averageSale: salesSummary._avg.total || 0
                },
                recentSales,
                topProducts: topProductsWithDetails,
                lowStock
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get store statistics');
        }
    }
    async getStoreEmployees(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }
            const employees = await prisma_1.prisma.employee.findMany({
                where: { storeId: id },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true,
                            emailVerified: true,
                            createdAt: true
                        }
                    },
                    _count: {
                        select: { sales: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
            res.json(employees);
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get store employees');
        }
    }
    async addEmployeeToStore(req, res) {
        try {
            const user = req.user;
            const { id: storeId } = req.params;
            const { userId, position = 'Clerk' } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            if (user.role === 'MANAGER' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Can only add employees to your store' });
            }
            const store = await prisma_1.prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }
            const userRecord = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                include: { employee: true }
            });
            if (!userRecord) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (userRecord.employee) {
                return res.status(400).json({ error: 'User is already an employee' });
            }
            const employee = await prisma_1.prisma.employee.create({
                data: {
                    firstName: userRecord.firstName,
                    lastName: userRecord.lastName,
                    phone: userRecord.phoneNumber || '',
                    position,
                    storeId,
                    userId
                },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true
                        }
                    },
                    store: true
                }
            });
            res.status(201).json({
                message: 'Employee added to store successfully',
                employee
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to add employee to store');
        }
    }
    async removeEmployeeFromStore(req, res) {
        try {
            const user = req.user;
            const { id: storeId, employeeId } = req.params;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            if (user.role === 'MANAGER' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Can only manage employees in your store' });
            }
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id: employeeId },
                include: {
                    store: true,
                    _count: {
                        select: { sales: true }
                    }
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (employee.storeId !== storeId) {
                return res.status(400).json({ error: 'Employee does not belong to this store' });
            }
            if (employee._count.sales > 0) {
                return res.status(400).json({
                    error: 'Cannot remove employee with sales history. Archive instead.'
                });
            }
            await prisma_1.prisma.employee.delete({
                where: { id: employeeId }
            });
            res.json({ message: 'Employee removed from store successfully' });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to remove employee from store');
        }
    }
}
exports.StoreController = StoreController;
//# sourceMappingURL=store-controller.js.map