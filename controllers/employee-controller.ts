import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta } from "../helpers";
import bcrypt from "bcrypt";
import { sendEmail } from "../lib/mail";

// Define custom type for authenticated request
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
}

export const getEmployees = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            page = 1,
            limit = 20,
            sortBy,
            sortOrder,
            search,
            storeId,
            position,
            role,
            status
        } = req.query;

        const { skip, take } = generatePagination(Number(page), Number(limit));

        const filterBuilder = new FilterBuilder()
            .where(search as string, ['user.firstName', 'user.lastName', 'user.email', 'position'])
            .store(storeId as string)
            .status(position as string, 'position')
            .status(role as string, 'role')
            .status(status as string, 'status')
            .includeWithDetails()
            .order(sortBy as string, sortOrder as 'asc' | 'desc');

        const filters = filterBuilder.build();

        // Extract where and orderBy from filters
        const whereClause = filters.where || {};
        const orderByClause = filters.orderBy || { createdAt: 'desc' };

        // Don't use includeClause from FilterBuilder - build include explicitly
        const include = {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    role: true,
                    isActive: true
                }
            },
            store: true,
            _count: {
                select: {
                    sales: true,
                    transfers: true,
                    performanceReviews: true
                }
            }
        };

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where: whereClause,
                skip,
                take,
                orderBy: orderByClause,
                include
            }),
            prisma.employee.count({ where: whereClause })
        ]);

        // Type the employee properly
        type EmployeeWithCount = typeof employees[0];

        // Calculate metrics for each employee
        const employeesWithMetrics = await Promise.all(
            employees.map(async (employee: EmployeeWithCount) => {
                // Get recent sales performance
                const recentSales = await prisma.sale.aggregate({
                    where: {
                        employeeId: employee.id,
                        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    },
                    _sum: { total: true },
                    _count: true
                });

                // Get average performance review score
                const avgScore = await prisma.performanceReview.aggregate({
                    where: { employeeId: employee.id },
                    _avg: { score: true }
                });

                return {
                    ...employee,
                    metrics: {
                        totalSales: employee._count.sales,
                        recentSalesCount: recentSales._count || 0,
                        recentSalesTotal: recentSales._sum?.total || 0,
                        avgReviewScore: avgScore._avg?.score || 0,
                        transferCount: employee._count.transfers
                    }
                };
            })
        );

        res.json({
            data: employeesWithMetrics,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get employees error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeeById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: {
                user: true,
                store: true,
                sales: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        store: true,
                        saleItems: {
                            include: { product: true }
                        }
                    }
                },
                transfers: {
                    orderBy: { transferDate: 'desc' },
                    take: 5,
                    include: {
                        fromStore: true,
                        toStore: true,
                        transferredByUser: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                performanceReviews: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    include: {
                        reviewer: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                }
            }
        });

        if (!employee) {
            res.status(404).json({ error: "Employee not found" });
            return;
        }

        // Type assertion to fix TypeScript inference issues
        const typedEmployee = employee as typeof employee & {
            sales: any[];
            transfers: any[];
            performanceReviews: any[];
        };

        // Calculate performance metrics
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [salesMetrics, recentReviews, attendanceData] = await Promise.all([
            // Sales metrics for last 30 days
            prisma.sale.aggregate({
                where: {
                    employeeId: employeeId,
                    createdAt: { gte: thirtyDaysAgo }
                },
                _sum: { total: true, subtotal: true, tax: true },
                _count: true,
                _avg: { total: true }
            }),

            // Recent performance reviews
            prisma.performanceReview.findMany({
                where: { employeeId: employeeId },
                orderBy: { createdAt: 'desc' },
                take: 3
            }),

            // Attendance/activity data (simplified - would integrate with time tracking system)
            prisma.activityLog.findMany({
                where: {
                    userId: typedEmployee.userId,
                    action: { in: ['LOGIN', 'SALE_CREATED', 'TRANSFER_COMPLETED'] },
                    createdAt: { gte: thirtyDaysAgo }
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            })
        ]);

        const performance = {
            salesLast30Days: {
                count: salesMetrics._count || 0,
                total: salesMetrics._sum?.total || 0,
                average: salesMetrics._avg?.total || 0,
                taxCollected: salesMetrics._sum?.tax || 0
            },
            recentReviews,
            activityCount: attendanceData.length,
            overallRating: recentReviews.length > 0
                ? recentReviews.reduce((sum, review) => sum + review.score, 0) / recentReviews.length
                : 0
        };

        res.json({
            employee: typedEmployee,
            performance,
            metrics: {
                totalSales: typedEmployee.sales.length,
                totalTransfers: typedEmployee.transfers.length,
                totalReviews: typedEmployee.performanceReviews.length
            }
        });
    } catch (error) {
        console.error("Get employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeeByUserId = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;

        const employee = await prisma.employee.findFirst({
            where: { userId },
            include: {
                user: true,
                store: true,
            }
        });

        if (!employee) {
            res.status(404).json({ error: "Employee not found for this user" });
            return;
        }

        res.json(employee);
    } catch (error) {
        console.error("Get employee by userId error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const createEmployee = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const {
            // User fields
            email,
            password,
            firstName,
            lastName,
            phone,

            // Employee fields
            storeId,
            position,
            role,
            hireDate,
            createdById
        } = req.body;

        console.log('Create employee with user registration attempt:', { email, firstName, lastName, position, role });

        // Validate required fields
        if (!email || !password || !firstName || !lastName) {
            res.status(400).json({ error: "User email, password, first name, and last name are required" });
            return;
        }

        if (!storeId || !position || !role) {
            res.status(400).json({ error: "Store ID, position, and role are required" });
            return;
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            console.log('User already exists:', email);
            res.status(400).json({ error: "User with this email already exists" });
            return;
        }

        // Check if store exists
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ error: "Store not found" });
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Use transaction to create both user and employee
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create the user
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    firstName,
                    lastName,
                    phone: phone || '',
                    role: role as any,
                    storeId,
                    isVerified: true, // Auto-verify since admin is creating them
                    isActive: true
                },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isVerified: true,
                    isActive: true,
                    storeId: true,
                    createdAt: true
                }
            });

            console.log('User created successfully:', user.id);

            // 2. Create the employee
            const employee = await tx.employee.create({
                data: {
                    userId: user.id,
                    storeId,
                    position,
                    role: role as any,
                    hireDate: hireDate ? new Date(hireDate) : new Date(),
                    createdById: createdById || req.user!.id,
                    status: 'ACTIVE'
                },
                include: {
                    user: true,
                    store: true
                }
            });

            console.log('Employee created successfully:', employee.id);

            return { user, employee };
        });

        // Send welcome email with login credentials
        try {
            await sendEmail(
                email,
                "Welcome to Agro Tire & Bale - Your Account Has Been Created",
                `
                <h1>Welcome to Agro Tire & Bale!</h1>
                <p>Hello ${firstName} ${lastName},</p>
                <p>An account has been created for you. You can now log in to the system.</p>
                <p><strong>Login credentials:</strong></p>
                <ul>
                    <li>Email: ${email}</li>
                    <li>Password: [The password you provided]</li>
                </ul>
                <p>Please log in and change your password for security.</p>
                <p>Login here: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login</p>
                `
            );
            console.log('Welcome email sent to:', email);
        } catch (emailError) {
            console.error('Failed to send welcome email:', emailError);
            // Don't fail the request if email fails
        }

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'EMPLOYEE_CREATED',
                    entityType: 'EMPLOYEE',
                    entityId: result.employee.id,
                    details: {
                        email: result.user.email,
                        firstName: result.user.firstName,
                        lastName: result.user.lastName,
                        position: result.employee.position,
                        role: result.employee.role
                    }
                }
            });
        }

        res.status(201).json({
            message: "Employee created successfully",
            user: result.user,
            employee: result.employee
        });
    } catch (error) {
        console.error("Create employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const updateEmployee = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;
        const {
            storeId,
            position,
            role,
            status,
            terminationDate
        } = req.body;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { user: true }
        });

        if (!employee) {
            res.status(404).json({ error: "Employee not found" });
            return;
        }

        // If store is being changed
        if (storeId && storeId !== employee.storeId) {
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                res.status(404).json({ error: "Store not found" });
                return;
            }

            // Create transfer record
            if (req.user?.id) {
                await prisma.employeeTransfer.create({
                    data: {
                        employeeId: employeeId,
                        fromStoreId: employee.storeId,
                        toStoreId: storeId,
                        reason: 'Store reassignment',
                        transferredBy: req.user.id,
                        transferDate: new Date()
                    }
                });
            }

            // Update user's store association
            await prisma.user.update({
                where: { id: employee.userId },
                data: { storeId }
            });
        }

        // If terminating employee
        if (status === 'TERMINATED' && employee.status !== 'TERMINATED') {
            if (!terminationDate) {
                res.status(400).json({ error: "Termination date is required when terminating employee" });
                return;
            }

            // Deactivate user account
            await prisma.user.update({
                where: { id: employee.userId },
                data: { isActive: false }
            });
        }

        // If reactivating employee
        if (status === 'ACTIVE' && employee.status !== 'ACTIVE') {
            // Reactivate user account
            await prisma.user.update({
                where: { id: employee.userId },
                data: { isActive: true }
            });
        }

        const updatedEmployee = await prisma.employee.update({
            where: { id: employeeId },
            data: {
                ...(storeId && { storeId }),
                ...(position && { position }),
                ...(role && { role: role as any }),
                ...(status && { status: status as any }),
                ...(terminationDate && { terminationDate: new Date(terminationDate) })
            },
            include: {
                user: true,
                store: true
            }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'EMPLOYEE_UPDATED',
                    entityType: 'EMPLOYEE',
                    entityId: employeeId,
                    details: {
                        updatedFields: Object.keys(req.body),
                        previousStatus: employee.status,
                        newStatus: status || employee.status
                    }
                }
            });
        }

        res.json(updatedEmployee);
    } catch (error) {
        console.error("Update employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const deleteEmployee = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: {
                _count: {
                    select: {
                        sales: true,
                        transfers: true
                    }
                },
                user: true
            }
        });

        if (!employee) {
            res.status(404).json({ error: "Employee not found" });
            return;
        }

        // Prevent deletion if employee has related records
        const hasRelatedRecords = Object.values(employee._count).some(count => count > 0);
        if (hasRelatedRecords) {
            res.status(400).json({
                error: "Cannot delete employee with related records (sales or transfers)"
            });
            return;
        }

        // Use transaction to delete both employee and user
        await prisma.$transaction(async (tx) => {
            // Delete employee first (due to foreign key constraints)
            await tx.employee.delete({ where: { id: employeeId } });

            // Delete the associated user
            await tx.user.delete({ where: { id: employee.userId } });
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'EMPLOYEE_DELETED',
                    entityType: 'EMPLOYEE',
                    entityId: employeeId,
                    details: {
                        employeeName: `${employee.user?.firstName || ''} ${employee.user?.lastName || ''}`
                    }
                }
            });
        }

        res.json({ message: "Employee and associated user deleted successfully" });
    } catch (error) {
        console.error("Delete employee error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeePerformance = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;
        const { period = '30d' } = req.query;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            include: { user: true, store: true }
        });

        if (!employee) {
            res.status(404).json({ error: "Employee not found" });
            return;
        }

        // Calculate date range
        const endDate = new Date();
        let startDate = new Date();

        switch (period) {
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                break;
            case '90d':
                startDate.setDate(startDate.getDate() - 90);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
            default:
                startDate.setDate(startDate.getDate() - 30);
        }

        // Types for raw query results
        type SalesDataRow = {
            date: Date;
            sales_count: number;
            total_revenue: number;
            avg_sale_amount: number;
            total_tax: number;
            unique_customers: number;
        };

        type ProductRow = {
            id: string;
            name: string;
            type: string;
            total_quantity: number;
            total_revenue: number;
            sales_count: number;
        };

        type StoreComparisonRow = {
            avg_daily_sales: number;
            avg_daily_revenue: number;
        };

        // Get sales performance data
        const salesData = await prisma.$queryRaw<SalesDataRow[]>`
      SELECT 
        DATE(s."createdAt") as date,
        COUNT(*) as sales_count,
        SUM(s.total) as total_revenue,
        AVG(s.total) as avg_sale_amount,
        SUM(s.tax) as total_tax,
        COUNT(DISTINCT s."customerName") as unique_customers
      FROM "Sale" s
      WHERE s."employeeId" = ${employeeId}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY DATE(s."createdAt")
      ORDER BY date ASC
    `;

        // Get top selling products
        const topProducts = await prisma.$queryRaw<ProductRow[]>`
      SELECT 
        p.id,
        p.name,
        p.type,
        SUM(si.quantity) as total_quantity,
        SUM(si.quantity * si.price) as total_revenue,
        COUNT(DISTINCT si."saleId") as sales_count
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si."productId"
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."employeeId" = ${employeeId}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY p.id, p.name, p.type
      ORDER BY total_revenue DESC
      LIMIT 10
    `;

        // Get performance reviews
        const reviews = await prisma.performanceReview.findMany({
            where: { employeeId: employeeId },
            orderBy: { createdAt: 'desc' },
            include: {
                reviewer: {
                    select: {
                        firstName: true,
                        lastName: true,
                        role: true
                    }
                }
            }
        });

        // Get comparison with store average
        const storeComparisonResult = await prisma.$queryRaw<StoreComparisonRow[]>`
      SELECT 
        AVG(daily_sales.sales_count) as avg_daily_sales,
        AVG(daily_sales.total_revenue) as avg_daily_revenue
      FROM (
        SELECT 
          DATE(s."createdAt") as date,
          COUNT(*) as sales_count,
          SUM(s.total) as total_revenue
        FROM "Sale" s
        WHERE s."storeId" = ${employee.storeId}
          AND s."createdAt" >= ${startDate}
          AND s."createdAt" <= ${endDate}
        GROUP BY DATE(s."createdAt")
      ) daily_sales
    `;

        const storeComparison = storeComparisonResult[0] || { avg_daily_sales: 0, avg_daily_revenue: 0 };

        // Calculate metrics with type safety
        const totalSales = salesData.reduce((sum, day) => sum + Number(day.sales_count), 0);
        const totalRevenue = salesData.reduce((sum, day) => sum + Number(day.total_revenue), 0);
        const avgDailySales = salesData.length > 0 ? totalSales / salesData.length : 0;
        const avgSaleAmount = totalSales > 0 ? totalRevenue / totalSales : 0;

        const performance = {
            period: {
                startDate,
                endDate,
                days: salesData.length
            },
            sales: {
                totalSales,
                totalRevenue,
                avgDailySales,
                avgSaleAmount,
                totalTax: salesData.reduce((sum, day) => sum + Number(day.total_tax), 0),
                uniqueCustomers: salesData.reduce((sum, day) => sum + Number(day.unique_customers), 0)
            },
            comparison: {
                storeAvgDailySales: storeComparison.avg_daily_sales || 0,
                storeAvgDailyRevenue: storeComparison.avg_daily_revenue || 0,
                performanceRatio: storeComparison.avg_daily_revenue > 0
                    ? (totalRevenue / salesData.length) / storeComparison.avg_daily_revenue
                    : 1
            },
            topProducts,
            reviews: {
                count: reviews.length,
                avgScore: reviews.length > 0
                    ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length
                    : 0,
                recent: reviews.slice(0, 3)
            }
        };

        res.json({
            employee,
            performance,
            salesTrend: salesData
        });
    } catch (error) {
        console.error("Get employee performance error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const createPerformanceReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;
        const {
            reviewerId,
            period,
            score,
            feedback,
            goals,
            strengths,
            areasForImprovement
        } = req.body;

        if (!reviewerId || !period || !score || score < 1 || score > 10) {
            res.status(400).json({
                error: "Reviewer ID, period, and score (1-10) are required"
            });
            return;
        }

        const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!employee) {
            res.status(404).json({ error: "Employee not found" });
            return;
        }

        const reviewer = await prisma.user.findUnique({ where: { id: reviewerId } });
        if (!reviewer) {
            res.status(404).json({ error: "Reviewer not found" });
            return;
        }

        const review = await prisma.performanceReview.create({
            data: {
                employeeId: employeeId,
                reviewerId,
                period: period as any,
                score: Number(score),
                feedback: feedback || '',
                goals: goals || [],
                strengths: strengths || [],
                areasForImprovement: areasForImprovement || []
            },
            include: {
                employee: {
                    include: { user: true }
                },
                reviewer: {
                    select: {
                        firstName: true,
                        lastName: true,
                        role: true
                    }
                }
            }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'PERFORMANCE_REVIEW_CREATED',
                    entityType: 'PERFORMANCE_REVIEW',
                    entityId: review.id,
                    details: {
                        employeeId: employeeId,
                        score,
                        period
                    }
                }
            });
        }

        res.status(201).json(review);
    } catch (error) {
        console.error("Create performance review error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeeTransfers = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const employeeId = Array.isArray(id) ? id[0] : id;
        const { page = 1, limit = 10 } = req.query;
        const { skip, take } = generatePagination(Number(page), Number(limit));

        const [transfers, total] = await Promise.all([
            prisma.employeeTransfer.findMany({
                where: { employeeId: employeeId },
                skip,
                take,
                include: {
                    fromStore: true,
                    toStore: true,
                    transferredByUser: {
                        select: {
                            firstName: true,
                            lastName: true,
                            role: true
                        }
                    }
                },
                orderBy: { transferDate: 'desc' }
            }),
            prisma.employeeTransfer.count({ where: { employeeId: employeeId } })
        ]);

        res.json({
            data: transfers,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get employee transfers error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getEmployeeStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { storeId } = req.query;

        // Build where clause
        const whereClause: any = {};
        if (storeId) {
            whereClause.storeId = storeId as string;
        }

        // Get counts by status
        const statusCounts = await prisma.employee.groupBy({
            by: ['status'],
            where: whereClause,
            _count: true
        });

        // Get counts by role
        const roleCounts = await prisma.employee.groupBy({
            by: ['role'],
            where: whereClause,
            _count: true
        });

        // Get counts by position
        const positionCounts = await prisma.employee.groupBy({
            by: ['position'],
            where: whereClause,
            _count: true,
            orderBy: {
                _count: {
                    position: 'desc'
                }
            },
            take: 10
        });

        // Get total employees
        const totalEmployees = await prisma.employee.count({ where: whereClause });

        // Get employees hired in last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const newHires = await prisma.employee.count({
            where: {
                ...whereClause,
                hireDate: {
                    gte: thirtyDaysAgo
                }
            }
        });

        // Get average performance score
        const avgPerformance = await prisma.performanceReview.aggregate({
            where: whereClause,
            _avg: {
                score: true
            }
        });

        // Get upcoming review count (reviews in next 30 days)
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        const upcomingReviews = await prisma.performanceReview.count({
            where: {
                employee: whereClause,
                createdAt: {
                    gte: new Date(),
                    lte: thirtyDaysFromNow
                }
            }
        });

        // Format the response
        const stats = {
            total: totalEmployees,
            byStatus: statusCounts.reduce((acc: any, item) => {
                acc[item.status.toLowerCase()] = item._count;
                return acc;
            }, {}),
            byRole: roleCounts.reduce((acc: any, item) => {
                acc[item.role.toLowerCase()] = item._count;
                return acc;
            }, {}),
            byPosition: positionCounts.map(item => ({
                position: item.position,
                count: item._count
            })),
            newHiresLast30Days: newHires,
            averagePerformanceScore: avgPerformance._avg.score || 0,
            upcomingReviews: upcomingReviews,
            // Additional metrics
            turnoverRate: 0, // You can calculate this based on terminated employees vs total
            activeEmployees: statusCounts.find(s => s.status === 'ACTIVE')?._count || 0,
            onLeaveEmployees: statusCounts.find(s => s.status === 'ON_LEAVE')?._count || 0,
            terminatedEmployees: statusCounts.find(s => s.status === 'TERMINATED')?._count || 0
        };

        res.json(stats);
    } catch (error) {
        console.error("Get employee stats error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};