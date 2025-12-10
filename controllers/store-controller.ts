// controllers/store.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';

export class StoreController extends BaseController {
    // Create store (Admin only)
    async createStore(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;

            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can create stores' });
            }

            const { name, location } = req.body;

            const store = await prisma.store.create({
                data: { name, location }
            });

            res.status(201).json({
                message: 'Store created successfully',
                store
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to create store');
        }
    }

    // Get all stores
    async getStores(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;

            let stores;
            if (user.role === 'ADMIN') {
                stores = await prisma.store.findMany({
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
            } else {
                // For non-admins, only return their store
                stores = await prisma.store.findMany({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get stores');
        }
    }

    // Get store by ID
    async getStoreById(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            // Check access
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }

            const store = await prisma.store.findUnique({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get store');
        }
    }

    // Update store (Admin only)
    async updateStore(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can update stores' });
            }

            const { name, location } = req.body;

            const updatedStore = await prisma.store.update({
                where: { id },
                data: { name, location }
            });

            res.json({
                message: 'Store updated successfully',
                store: updatedStore
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to update store');
        }
    }

    // Delete store (Admin only)
    async deleteStore(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can delete stores' });
            }

            // Check if store has employees or products
            const store = await prisma.store.findUnique({
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

            await prisma.store.delete({
                where: { id }
            });

            res.json({ message: 'Store deleted successfully' });
        } catch (error) {
            this.handleError(res, error, 'Failed to delete store');
        }
    }

    // Get store statistics
    async getStoreStats(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            // Check access
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }

            const [stats, recentSales, topProducts, lowStock] = await Promise.all([
                // Basic stats
                prisma.store.findUnique({
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

                // Recent sales (last 10)
                prisma.sale.findMany({
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

                // Top products
                prisma.saleItem.groupBy({
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

                // Low stock products
                prisma.product.findMany({
                    where: {
                        storeId: id,
                        quantity: { lte: 10 }
                    },
                    orderBy: { quantity: 'asc' },
                    take: 10
                })
            ]);

            // Get product details for top products
            const topProductsWithDetails = await Promise.all(
                topProducts.map(async (item: { productId: any; }) => {
                    const product = await prisma.product.findUnique({
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
                })
            );

            // Get sales summary for last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const salesSummary = await prisma.sale.aggregate({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get store statistics');
        }
    }

    // Get store employees
    async getStoreEmployees(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id } = req.params;

            // Check access
            if (user.role !== 'ADMIN' && user.storeId !== id) {
                return res.status(403).json({ error: 'Access denied to this store' });
            }

            const employees = await prisma.employee.findMany({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to get store employees');
        }
    }

    // Add employee to store (Admin/Manager)
    async addEmployeeToStore(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id: storeId } = req.params;
            const { userId, position = 'Clerk' } = req.body;

            // Check permissions
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            if (user.role === 'MANAGER' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Can only add employees to your store' });
            }

            // Check if store exists
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }

            // Check if user exists and doesn't already have an employee record
            const userRecord = await prisma.user.findUnique({
                where: { id: userId },
                include: { employee: true }
            });

            if (!userRecord) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (userRecord.employee) {
                return res.status(400).json({ error: 'User is already an employee' });
            }

            // Create employee record
            const employee = await prisma.employee.create({
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
        } catch (error) {
            this.handleError(res, error, 'Failed to add employee to store');
        }
    }

    // Remove employee from store (Admin/Manager)
    async removeEmployeeFromStore(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const { id: storeId, employeeId } = req.params;

            // Check permissions
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            if (user.role === 'MANAGER' && user.storeId !== storeId) {
                return res.status(403).json({ error: 'Can only manage employees in your store' });
            }

            const employee = await prisma.employee.findUnique({
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

            // Check if employee has sales
            if (employee._count.sales > 0) {
                return res.status(400).json({
                    error: 'Cannot remove employee with sales history. Archive instead.'
                });
            }

            await prisma.employee.delete({
                where: { id: employeeId }
            });

            res.json({ message: 'Employee removed from store successfully' });
        } catch (error) {
            this.handleError(res, error, 'Failed to remove employee from store');
        }
    }
}