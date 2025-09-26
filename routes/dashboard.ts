import express from "express";
import { authenticateToken, requireEmployee } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = express.Router();

// ============ DASHBOARD ROUTES ============
router.get('/overview',
    authenticateToken,
    requireEmployee,
    async (req: any, res: any) => {
        try {
            const { user } = req;
            const storeFilter = user.role === 'ADMIN' ? {} : { storeId: user.storeId };

            const [
                totalStores,
                totalEmployees,
                totalProducts,
                totalSales,
                lowStockProducts,
                recentSales
            ] = await Promise.all([
                user.role === 'ADMIN' ?
                    prisma.store.count() :
                    Promise.resolve(user.storeId ? 1 : 0),
                prisma.employee.count({ where: storeFilter }),
                prisma.product.count({ where: storeFilter }),
                prisma.sale.count({
                    where: {
                        ...storeFilter,
                        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                    },
                }),
                prisma.product.count({
                    where: { ...storeFilter, quantity: { lte: 5 } },
                }),
                prisma.sale.findMany({
                    where: storeFilter,
                    include: {
                        employee: { select: { firstName: true, lastName: true } },
                        _count: { select: { saleItems: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                }),
            ]);

            res.json({
                overview: { totalStores, totalEmployees, totalProducts, totalSales, lowStockProducts },
                recentSales,
                userInfo: {
                    role: user.role,
                    storeId: user.storeId,
                    employeeId: user.employeeId,
                },
            });
        } catch (error) {
            console.error('Dashboard overview error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

export default router;
