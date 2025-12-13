import { prisma } from "../../lib/prisma";
import { Role } from "@prisma/client";

/**
 * WORKFORCE EMPLOYEE CONTROLLER: Employee management and store assignments
 * 
 * Aggregate Root: Employee
 * Coordinates: User (linkage), Store (assignment), Sale (performance)
 * 
 * Key Invariants:
 * 1. Employee must be linked to a User
 * 2. Employee can only be assigned to one store at a time
 * 3. User role must match employee role
 */

// ============ EMPLOYEE CREATION & MANAGEMENT ============

/**
 * Create a new employee by linking to existing user
 * 
 * @param userId User ID to link as employee
 * @param storeId Store to assign employee to
 * @param position Employee position/title
 * @param role Employee role (must match user role)
 * @param createdBy User ID creating the employee record
 */
export const createEmployee = async (
    userId: string,
    storeId: string,
    position: string,
    role: Role,
    createdBy: string
): Promise<{ employee: any; user: any }> => {
    // Validate inputs
    if (!userId || !storeId || !position || !role) {
        throw new Error("MISSING_REQUIRED_FIELDS: User ID, store ID, position, and role are required");
    }

    // Transaction: Validate + create employee atomically
    return await prisma.$transaction(async (tx) => {
        // Verify user exists and is active
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: User does not exist");
        }

        if (!user.isActive) {
            throw new Error("USER_INACTIVE: User account is not active");
        }

        // Verify user role matches employee role
        if (user.role !== role) {
            throw new Error(
                `ROLE_MISMATCH: User role (${user.role}) does not match employee role (${role})`
            );
        }

        // Verify store exists
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) {
            throw new Error("STORE_NOT_FOUND: Store does not exist");
        }

        // Check if user is already an employee
        const existingEmployee = await tx.employee.findUnique({ where: { userId } });
        if (existingEmployee) {
            throw new Error("EMPLOYEE_EXISTS: User is already registered as an employee");
        }

        // Create employee
        const employee = await tx.employee.create({
            data: {
                userId,
                storeId,
                position,
                role
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        role: true,
                        isActive: true
                    }
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        location: true
                    }
                }
            }
        });

        // Update user's store assignment
        await tx.user.update({
            where: { id: userId },
            data: { storeId }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: createdBy,
                action: "EMPLOYEE_CREATED",
                entityType: "EMPLOYEE",
                entityId: employee.id,
                details: {
                    userId,
                    storeId,
                    position,
                    role
                },
                createdAt: new Date()
            }
        });

        return { employee, user: employee.user };
    });
};

/**
 * Update employee details
 * 
 * @param employeeId Employee ID to update
 * @param updates Fields to update
 * @param updatedBy User ID making update
 */
export const updateEmployee = async (
    employeeId: string,
    updates: {
        position?: string;
        role?: Role;
        storeId?: string;
    },
    updatedBy: string
): Promise<{ employee: any; changes: string[] }> => {
    // Validate at least one field is being updated
    if (Object.keys(updates).length === 0) {
        throw new Error("NO_UPDATES_PROVIDED: At least one field must be updated");
    }

    // Transaction: Validate + update employee + update user atomically
    return await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUnique({
            where: { id: employeeId },
            include: {
                user: true
            }
        });

        if (!employee) {
            throw new Error("EMPLOYEE_NOT_FOUND: Employee does not exist");
        }

        const changes = [];

        // Validate store if changing
        if (updates.storeId && updates.storeId !== employee.storeId) {
            const store = await tx.store.findUnique({ where: { id: updates.storeId } });
            if (!store) {
                throw new Error("STORE_NOT_FOUND: Store does not exist");
            }
            changes.push(`store: ${employee.storeId} → ${updates.storeId}`);
        }

        // Validate role if changing
        if (updates.role && updates.role !== employee.role) {
            // Update user role as well
            await tx.user.update({
                where: { id: employee.userId },
                data: { role: updates.role }
            });
            changes.push(`role: ${employee.role} → ${updates.role}`);
        }

        // Update employee
        const updatedEmployee = await tx.employee.update({
            where: { id: employeeId },
            data: updates,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        role: true,
                        isActive: true
                    }
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        location: true
                    }
                }
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: updatedBy,
                action: "EMPLOYEE_UPDATED",
                entityType: "EMPLOYEE",
                entityId: employeeId,
                details: { changes },
                createdAt: new Date()
            }
        });

        return { employee: updatedEmployee, changes };
    });
};

/**
 * Get employee details with performance metrics
 * 
 * @param employeeId Employee ID
 */
export const getEmployeeDetails = async (
    employeeId: string
): Promise<any> => {
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    role: true,
                    isActive: true,
                    isVerified: true,
                    lastLogin: true,
                    createdAt: true
                }
            },
            store: {
                select: {
                    id: true,
                    name: true,
                    location: true,
                    isMainStore: true
                }
            },
            sales: {
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    total: true,
                    createdAt: true,
                    paymentMethod: true
                }
            },
            _count: {
                select: {
                    sales: true
                }
            }
        }
    });

    if (!employee) {
        throw new Error("EMPLOYEE_NOT_FOUND: Employee does not exist");
    }

    // Get performance metrics (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [salesStats, recentActivity] = await Promise.all([
        // Sales statistics
        prisma.sale.aggregate({
            where: {
                employeeId,
                createdAt: { gte: thirtyDaysAgo }
            },
            _sum: { total: true },
            _count: true,
            _avg: { total: true }
        }),
        // Recent activity
        prisma.activityLog.findMany({
            where: {
                userId: employee.userId,
                createdAt: { gte: thirtyDaysAgo }
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
                action: true,
                entityType: true,
                entityId: true,
                createdAt: true
            }
        })
    ]);

    return {
        ...employee,
        performance: {
            last30Days: {
                totalSales: salesStats._count || 0,
                totalRevenue: salesStats._sum.total || 0,
                averageSale: salesStats._avg.total || 0
            }
        },
        recentActivity
    };
};

/**
 * Get all employees with optional filters
 * 
 * @param filters Employee filters
 * @param page Page number
 * @param limit Items per page
 */
export const getEmployees = async (
    filters: {
        storeId?: string;
        role?: Role;
        position?: string;
        search?: string;
        activeOnly?: boolean;
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    employees: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.storeId) {
        whereCondition.storeId = filters.storeId;
    }
    if (filters.role) {
        whereCondition.role = filters.role;
    }
    if (filters.position) {
        whereCondition.position = { contains: filters.position, mode: 'insensitive' };
    }
    if (filters.activeOnly !== undefined) {
        whereCondition.user = { isActive: filters.activeOnly };
    }

    // Handle search across user fields
    if (filters.search) {
        whereCondition.OR = [
            { position: { contains: filters.search, mode: 'insensitive' } },
            {
                user: {
                    OR: [
                        { firstName: { contains: filters.search, mode: 'insensitive' } },
                        { lastName: { contains: filters.search, mode: 'insensitive' } },
                        { email: { contains: filters.search, mode: 'insensitive' } }
                    ]
                }
            }
        ];
    }

    const [employees, total] = await Promise.all([
        prisma.employee.findMany({
            where: whereCondition,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        role: true,
                        isActive: true,
                        lastLogin: true
                    }
                },
                store: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        sales: true
                    }
                }
            },
            orderBy: [
                { user: { lastName: 'asc' } },
                { user: { firstName: 'asc' } }
            ],
            skip,
            take: limit
        }),
        prisma.employee.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        employees,
        total,
        page,
        totalPages
    };
};

/**
 * Transfer employee to different store
 * 
 * @param employeeId Employee ID
 * @param newStoreId New store ID
 * @param transferredBy User ID performing transfer
 * @param reason Optional reason for transfer
 */
export const transferEmployee = async (
    employeeId: string,
    newStoreId: string,
    transferredBy: string,
    reason?: string
): Promise<{ employee: any; oldStore: any; newStore: any }> => {
    // Transaction: Update employee + update user store assignment atomically
    return await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUnique({
            where: { id: employeeId },
            include: {
                store: true,
                user: true
            }
        });

        if (!employee) {
            throw new Error("EMPLOYEE_NOT_FOUND: Employee does not exist");
        }

        if (employee.storeId === newStoreId) {
            throw new Error("SAME_STORE: Employee is already assigned to this store");
        }

        // Verify new store exists
        const newStore = await tx.store.findUnique({ where: { id: newStoreId } });
        if (!newStore) {
            throw new Error("NEW_STORE_NOT_FOUND: New store does not exist");
        }

        const oldStore = employee.store;

        // Update employee store assignment
        const updatedEmployee = await tx.employee.update({
            where: { id: employeeId },
            data: { storeId: newStoreId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true
                    }
                },
                store: {
                    select: {
                        id: true,
                        name: true,
                        location: true
                    }
                }
            }
        });

        // Update user's store assignment
        await tx.user.update({
            where: { id: employee.userId },
            data: { storeId: newStoreId }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: transferredBy,
                action: "EMPLOYEE_TRANSFERRED",
                entityType: "EMPLOYEE",
                entityId: employeeId,
                details: {
                    oldStoreId: oldStore.id,
                    oldStoreName: oldStore.name,
                    newStoreId: newStore.id,
                    newStoreName: newStore.name,
                    reason
                },
                createdAt: new Date()
            }
        });

        return {
            employee: updatedEmployee,
            oldStore,
            newStore
        };
    });
};

/**
 * Get employee performance report
 * 
 * @param employeeId Employee ID
 * @param period Time period (day, week, month, year)
 */
export const getEmployeePerformance = async (
    employeeId: string,
    period: 'day' | 'week' | 'month' | 'year'
): Promise<{
    employee: any;
    period: string;
    sales: {
        revenue: number;
        transactions: number;
        averageTransaction: number;
        bestSellingProducts: Array<{ productId: string; productName: string; quantity: number; revenue: number }>;
        salesByHour?: Array<{ hour: number; sales: number; revenue: number }>;
    };
    comparison?: {
        storeAverage: number;
        employeeRank: number;
        topPerformer: { name: string; revenue: number };
    };
}> => {
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true
                }
            },
            store: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    if (!employee) {
        throw new Error("EMPLOYEE_NOT_FOUND: Employee does not exist");
    }

    const now = new Date();
    let startDate: Date;

    switch (period) {
        case 'day':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    // Get employee sales for period
    const sales = await prisma.sale.findMany({
        where: {
            employeeId,
            createdAt: {
                gte: startDate,
                lte: now
            }
        },
        include: {
            saleItems: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        }
    });

    // Calculate sales metrics
    const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const transactions = sales.length;
    const averageTransaction = transactions > 0 ? revenue / transactions : 0;

    // Group by product
    const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    sales.forEach(sale => {
        sale.saleItems.forEach(item => {
            const productKey = item.productId;
            if (!productMap.has(productKey)) {
                productMap.set(productKey, {
                    name: item.product.name,
                    quantity: 0,
                    revenue: 0
                });
            }
            const productData = productMap.get(productKey)!;
            productData.quantity += item.quantity;
            productData.revenue += item.price * item.quantity;
        });
    });

    const result: any = {
        employee,
        period,
        sales: {
            revenue,
            transactions,
            averageTransaction,
            bestSellingProducts: Array.from(productMap.entries())
                .map(([id, data]) => ({
                    productId: id,
                    productName: data.name,
                    quantity: data.quantity,
                    revenue: data.revenue
                }))
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 10)
        }
    };

    // Add hourly breakdown for daily period
    if (period === 'day') {
        const salesByHour: Record<number, { sales: number; revenue: number }> = {};
        for (let hour = 0; hour < 24; hour++) {
            salesByHour[hour] = { sales: 0, revenue: 0 };
        }

        sales.forEach(sale => {
            const hour = sale.createdAt.getHours();
            salesByHour[hour].sales++;
            salesByHour[hour].revenue += sale.total;
        });

        result.sales.salesByHour = Object.entries(salesByHour).map(([hour, data]: [string, any]) => ({
            hour: parseInt(hour),
            sales: data.sales,
            revenue: data.revenue
        }));
    }

    // Add comparison data for monthly and yearly periods
    if (period === 'month' || period === 'year') {
        // Get all employees in same store for comparison
        const storeEmployees = await prisma.employee.findMany({
            where: { storeId: employee.storeId },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true
                    }
                }
            }
        });

        const employeePerformances = await Promise.all(
            storeEmployees.map(async (emp) => {
                const empSales = await prisma.sale.aggregate({
                    where: {
                        employeeId: emp.id,
                        createdAt: {
                            gte: startDate,
                            lte: now
                        }
                    },
                    _sum: { total: true },
                    _count: true
                });

                return {
                    employeeId: emp.id,
                    employeeName: `${emp.user.firstName} ${emp.user.lastName}`,
                    revenue: empSales._sum.total || 0,
                    transactions: empSales._count || 0
                };
            })
        );

        // Sort by revenue
        employeePerformances.sort((a, b) => b.revenue - a.revenue);

        // Find this employee's rank
        const employeeRank = employeePerformances.findIndex(
            perf => perf.employeeId === employeeId
        ) + 1;

        // Calculate store average
        const storeAverage = employeePerformances.length > 0
            ? employeePerformances.reduce((sum, perf) => sum + perf.revenue, 0) / employeePerformances.length
            : 0;

        result.comparison = {
            storeAverage,
            employeeRank,
            topPerformer: employeePerformances.length > 0
                ? {
                    name: employeePerformances[0].employeeName,
                    revenue: employeePerformances[0].revenue
                }
                : { name: "N/A", revenue: 0 }
        };
    }

    return result;
};

/**
 * Get store staff summary
 * 
 * @param storeId Store ID
 */
export const getStoreStaffSummary = async (
    storeId: string
): Promise<{
    store: any;
    summary: {
        totalEmployees: number;
        byRole: Record<string, number>;
        activeEmployees: number;
        inactiveEmployees: number;
    };
    employees: Array<{
        id: string;
        name: string;
        role: string;
        position: string;
        lastLogin?: Date;
        salesLast30Days: number;
        revenueLast30Days: number;
    }>;
}> => {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
        throw new Error("STORE_NOT_FOUND: Store does not exist");
    }

    const employees = await prisma.employee.findMany({
        where: { storeId },
        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isActive: true,
                    lastLogin: true
                }
            }
        }
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get sales data for each employee
    const employeesWithSales = await Promise.all(
        employees.map(async (emp) => {
            const salesStats = await prisma.sale.aggregate({
                where: {
                    employeeId: emp.id,
                    createdAt: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
                _count: true
            });

            return {
                id: emp.id,
                name: `${emp.user.firstName} ${emp.user.lastName}`,
                role: emp.role as string,  // Convert Role enum to string
                position: emp.position,
                lastLogin: emp.user.lastLogin ?? undefined,  // Convert null to undefined
                salesLast30Days: salesStats._count || 0,
                revenueLast30Days: salesStats._sum.total || 0
            };
        })
    );

    // Calculate summary
    const byRole: Record<string, number> = {};
    let activeEmployees = 0;
    let inactiveEmployees = 0;

    employees.forEach(emp => {
        // Count by role
        const role = emp.role;
        byRole[role] = (byRole[role] || 0) + 1;

        // Count active/inactive
        if (emp.user.isActive) {
            activeEmployees++;
        } else {
            inactiveEmployees++;
        }
    });

    return {
        store,
        summary: {
            totalEmployees: employees.length,
            byRole,
            activeEmployees,
            inactiveEmployees
        },
        employees: employeesWithSales.sort((a, b) => b.revenueLast30Days - a.revenueLast30Days)
    };
};