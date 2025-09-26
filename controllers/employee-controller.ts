import bcrypt from "bcrypt";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

interface EmployeeRequest extends Request {
    body: {
        firstName: string;
        lastName: string;
        phone: string;
        email: string;
        password: string;
        role: "MANAGER" | "CASHIER";
        storeId: string;
    };
}

// CREATE EMPLOYEE (Also creates user account)
export const createEmployee = async (req: EmployeeRequest, res: Response) => {
    try {
        const { firstName, lastName, phone, email, password, role, storeId } = req.body;

        if (!firstName || !lastName || !phone || !email || !password || !role || !storeId) {
            return res.status(400).json({ error: "All fields are required" });
        }

        // Check if store exists
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) return res.status(400).json({ error: "Store not found" });

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ error: "Email already exists" });

        const passwordHash = await bcrypt.hash(password, 12);

        // Create user and employee in transaction
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    passwordHash,
                    role: role as any,
                    isVerified: true, // Auto-verify employee accounts
                },
            });

            const employee = await tx.employee.create({
                data: {
                    firstName,
                    lastName,
                    phone,
                    storeId,
                    userId: user.id,
                },
                include: {
                    user: { select: { id: true, email: true, role: true } },
                    store: { select: { id: true, name: true, location: true } },
                },
            });

            return employee;
        });

        res.status(201).json({
            message: "Employee created successfully",
            employee: result,
        });
    } catch (error) {
        console.error("Employee creation error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET ALL EMPLOYEES
export const getEmployees = async (req: Request, res: Response) => {
    try {
        const { storeId, role } = req.query;

        const where: any = {};
        if (storeId) where.storeId = storeId as string;
        if (role) where.user = { role: role as string };

        const employees = await prisma.employee.findMany({
            where,
            include: {
                user: { select: { id: true, email: true, role: true, isVerified: true } },
                store: { select: { id: true, name: true, location: true } },
                _count: { select: { sales: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json({ employees });
    } catch (error) {
        console.error("Get employees error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET EMPLOYEE BY ID
export const getEmployeeById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const employee = await prisma.employee.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, email: true, role: true, isVerified: true } },
                store: { select: { id: true, name: true, location: true } },
                sales: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    select: {
                        id: true,
                        total: true,
                        createdAt: true,
                        saleItems: {
                            select: {
                                quantity: true,
                                price: true,
                                product: { select: { name: true, type: true } },
                            },
                        },
                    },
                },
                _count: { select: { sales: true } },
            },
        });

        if (!employee) return res.status(404).json({ error: "Employee not found" });

        res.json({ employee });
    } catch (error) {
        console.error("Get employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// UPDATE EMPLOYEE
export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, phone, email, role, storeId } = req.body;

        const employee = await prisma.employee.findUnique({
            where: { id },
            include: { user: true },
        });

        if (!employee) return res.status(404).json({ error: "Employee not found" });

        if (storeId) {
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (!store) return res.status(400).json({ error: "Store not found" });
        }

        // Check if new email already exists (if email is being changed)
        if (email && email !== employee.user.email) {
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) return res.status(400).json({ error: "Email already exists" });
        }

        const updatedEmployee = await prisma.$transaction(async (tx) => {
            // Update user info
            if (email || role) {
                await tx.user.update({
                    where: { id: employee.userId },
                    data: {
                        ...(email && { email }),
                        ...(role && { role: role as any }),
                    },
                });
            }

            // Update employee info
            return await tx.employee.update({
                where: { id },
                data: {
                    ...(firstName && { firstName }),
                    ...(lastName && { lastName }),
                    ...(phone && { phone }),
                    ...(storeId && { storeId }),
                },
                include: {
                    user: { select: { id: true, email: true, role: true } },
                    store: { select: { id: true, name: true, location: true } },
                },
            });
        });

        res.json({
            message: "Employee updated successfully",
            employee: updatedEmployee,
        });
    } catch (error) {
        console.error("Update employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// DELETE EMPLOYEE
export const deleteEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const employee = await prisma.employee.findUnique({
            where: { id },
            include: { _count: { select: { sales: true } } },
        });

        if (!employee) return res.status(404).json({ error: "Employee not found" });

        // Check if employee has sales records
        if (employee._count.sales > 0) {
            return res.status(400).json({
                error: "Cannot delete employee with existing sales records"
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.employee.delete({ where: { id } });
            await tx.user.delete({ where: { id: employee.userId } });
        });

        res.json({ message: "Employee deleted successfully" });
    } catch (error) {
        console.error("Delete employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// GET EMPLOYEE SALES PERFORMANCE
export const getEmployeeSalesPerformance = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, storeId } = req.query;

        const where: any = { employeeId: id };
        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string),
            };
        }
        if (storeId) where.storeId = storeId as string;

        const [sales, totalSales, totalRevenue] = await Promise.all([
            prisma.sale.findMany({
                where,
                include: {
                    saleItems: {
                        select: {
                            quantity: true,
                            price: true,
                            product: { select: { name: true, type: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            }),
            prisma.sale.count({ where }),
            prisma.sale.aggregate({
                where,
                _sum: { total: true },
            }),
        ]);

        res.json({
            employee: { id },
            performance: {
                totalSales,
                totalRevenue: totalRevenue._sum.total || 0,
                sales,
            },
        });
    } catch (error) {
        console.error("Get employee performance error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};