"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const email_1 = require("../utils/email");
class EmployeeController extends base_controller_1.BaseController {
    async createEmployee(req, res) {
        try {
            const user = req.user;
            const { firstName, lastName, email, phone, position, storeId, role = 'CASHIER', sendInvitation = true } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            if (user.role === 'MANAGER') {
                if (storeId && storeId !== user.storeId) {
                    return res.status(403).json({ error: 'Can only create employees for your store' });
                }
            }
            const targetStoreId = storeId || (user.role === 'MANAGER' ? user.storeId : null);
            if (!targetStoreId) {
                return res.status(400).json({ error: 'Store ID is required' });
            }
            const store = await prisma_1.prisma.store.findUnique({
                where: { id: targetStoreId }
            });
            if (!store) {
                return res.status(404).json({ error: 'Store not found' });
            }
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { email }
            });
            if (existingUser) {
                return res.status(400).json({ error: 'Email already registered' });
            }
            const tempPassword = crypto_1.default.randomBytes(8).toString('hex');
            const salt = await bcryptjs_1.default.genSalt(10);
            const passwordHash = await bcryptjs_1.default.hash(tempPassword, salt);
            const result = await prisma_1.prisma.$transaction(async (tx) => {
                const newUser = await tx.user.create({
                    data: {
                        firstName,
                        lastName,
                        email,
                        passwordHash,
                        phoneNumber: phone || '',
                        role
                    }
                });
                const employee = await tx.employee.create({
                    data: {
                        firstName,
                        lastName,
                        phone: phone || '',
                        position: position || 'Clerk',
                        storeId: targetStoreId,
                        userId: newUser.id
                    },
                    include: {
                        store: true,
                        user: {
                            select: {
                                email: true,
                                role: true,
                                emailVerified: true
                            }
                        }
                    }
                });
                if (sendInvitation) {
                    const verificationCode = crypto_1.default.randomInt(100000, 999999).toString();
                    await tx.verificationCode.create({
                        data: {
                            userId: newUser.id,
                            code: verificationCode,
                            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                        }
                    });
                    await (0, email_1.sendEmail)({
                        to: email,
                        subject: 'Welcome to Inventory Management System',
                        html: `
              <h1>Welcome ${firstName}!</h1>
              <p>Your account has been created with the following details:</p>
              <ul>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Temporary Password:</strong> ${tempPassword}</li>
                <li><strong>Role:</strong> ${role}</li>
                <li><strong>Store:</strong> ${store.name} (${store.location})</li>
                <li><strong>Position:</strong> ${position || 'Clerk'}</li>
              </ul>
              <p>Please log in and change your password immediately.</p>
              ${role !== 'CASHIER' ? `<p><strong>Note:</strong> As a ${role}, you have additional permissions to manage store operations.</p>` : ''}
              <p>Verification Code: <strong>${verificationCode}</strong></p>
              <p>This code will expire in 7 days.</p>
            `
                    });
                }
                return { user: newUser, employee };
            });
            res.status(201).json({
                message: sendInvitation ? 'Employee created and invitation sent' : 'Employee created successfully',
                employee: {
                    id: result.employee.id,
                    firstName: result.employee.firstName,
                    lastName: result.employee.lastName,
                    phone: result.employee.phone,
                    position: result.employee.position,
                    store: result.employee.store,
                    user: {
                        email: result.employee.user.email,
                        role: result.employee.user.role,
                        emailVerified: result.employee.user.emailVerified
                    },
                    temporaryPassword: sendInvitation ? tempPassword : undefined
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to create employee');
        }
    }
    async getEmployees(req, res) {
        try {
            const user = req.user;
            const { storeId, role, position, search, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            let where = {};
            if (user.role === 'MANAGER') {
                where.storeId = user.storeId;
            }
            else if (user.role === 'ADMIN' && storeId) {
                where.storeId = storeId;
            }
            else if (user.role === 'CASHIER') {
                const employee = await prisma_1.prisma.employee.findUnique({
                    where: { userId: user.id }
                });
                if (employee) {
                    where.id = employee.id;
                }
                else {
                    return res.json({ employees: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
                }
            }
            if (position) {
                where.position = position;
            }
            if (search) {
                where.OR = [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search, mode: 'insensitive' } }
                ];
            }
            let userWhere = {};
            if (role) {
                userWhere.role = role;
            }
            if (search) {
                userWhere.OR = [
                    { email: { contains: search, mode: 'insensitive' } }
                ];
            }
            const [employees, total] = await Promise.all([
                prisma_1.prisma.employee.findMany({
                    where,
                    include: {
                        store: {
                            select: {
                                name: true,
                                location: true
                            }
                        },
                        user: {
                            select: {
                                email: true,
                                role: true,
                                emailVerified: true,
                                createdAt: true
                            },
                            where: userWhere
                        },
                        _count: {
                            select: {
                                sales: true
                            }
                        }
                    },
                    orderBy: { [sortBy]: sortOrder },
                    skip,
                    take: limitNum
                }),
                prisma_1.prisma.employee.count({ where })
            ]);
            const filteredEmployees = role
                ? employees.filter((emp) => emp.user?.role === role)
                : employees;
            res.json({
                employees: filteredEmployees.map((emp) => ({
                    id: emp.id,
                    firstName: emp.firstName,
                    lastName: emp.lastName,
                    phone: emp.phone,
                    position: emp.position,
                    store: emp.store,
                    user: emp.user,
                    salesCount: emp._count.sales,
                    createdAt: emp.createdAt,
                    updatedAt: emp.updatedAt
                })),
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: filteredEmployees.length,
                    pages: Math.ceil(filteredEmployees.length / limitNum)
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employees');
        }
    }
    async getEmployeeById(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    store: true,
                    user: {
                        select: {
                            email: true,
                            role: true,
                            emailVerified: true,
                            createdAt: true,
                            updatedAt: true
                        }
                    },
                    sales: {
                        include: {
                            saleItems: {
                                include: {
                                    product: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        },
                        take: 10
                    },
                    _count: {
                        select: {
                            sales: true
                        }
                    }
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'CASHIER') {
                const currentEmployee = await prisma_1.prisma.employee.findUnique({
                    where: { userId: user.id }
                });
                if (currentEmployee?.id !== employee.id) {
                    return res.status(403).json({ error: 'Access denied to this employee' });
                }
            }
            else if (user.role === 'MANAGER') {
                if (employee.storeId !== user.storeId) {
                    return res.status(403).json({ error: 'Access denied to this employee' });
                }
            }
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const recentSales = await prisma_1.prisma.sale.aggregate({
                where: {
                    employeeId: employee.id,
                    createdAt: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
            const performance = {
                last30Days: {
                    totalSales: recentSales._count,
                    totalRevenue: recentSales._sum.total || 0,
                    averageSale: recentSales._avg.total || 0
                },
                allTime: {
                    totalSales: employee._count.sales
                }
            };
            res.json({
                employee: {
                    id: employee.id,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    phone: employee.phone,
                    position: employee.position,
                    store: employee.store,
                    user: employee.user,
                    performance,
                    recentSales: employee.sales,
                    createdAt: employee.createdAt,
                    updatedAt: employee.updatedAt
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employee');
        }
    }
    async updateEmployee(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { firstName, lastName, phone, position, storeId, role } = req.body;
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    store: true,
                    user: true
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            if (user.role === 'MANAGER') {
                if (employee.storeId !== user.storeId) {
                    return res.status(403).json({ error: 'Can only update employees in your store' });
                }
                if (storeId || role) {
                    return res.status(403).json({ error: 'Managers cannot change store or role' });
                }
            }
            const employeeUpdateData = {};
            const userUpdateData = {};
            if (firstName !== undefined) {
                employeeUpdateData.firstName = firstName;
                userUpdateData.firstName = firstName;
            }
            if (lastName !== undefined) {
                employeeUpdateData.lastName = lastName;
                userUpdateData.lastName = lastName;
            }
            if (phone !== undefined)
                employeeUpdateData.phone = phone;
            if (position !== undefined)
                employeeUpdateData.position = position;
            if (storeId !== undefined && user.role === 'ADMIN')
                employeeUpdateData.storeId = storeId;
            if (role !== undefined && user.role === 'ADMIN')
                userUpdateData.role = role;
            const updatedEmployee = await prisma_1.prisma.$transaction(async (tx) => {
                const emp = await tx.employee.update({
                    where: { id },
                    data: employeeUpdateData,
                    include: {
                        store: true
                    }
                });
                if (Object.keys(userUpdateData).length > 0) {
                    await tx.user.update({
                        where: { id: employee.userId },
                        data: userUpdateData
                    });
                }
                const updatedUser = await tx.user.findUnique({
                    where: { id: employee.userId },
                    select: {
                        email: true,
                        role: true,
                        emailVerified: true
                    }
                });
                return { ...emp, user: updatedUser };
            });
            res.json({
                message: 'Employee updated successfully',
                employee: updatedEmployee
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to update employee');
        }
    }
    async deleteEmployee(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            if (user.role !== 'ADMIN') {
                return res.status(403).json({ error: 'Only admins can delete employees' });
            }
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    user: true,
                    _count: {
                        select: {
                            sales: true
                        }
                    }
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (employee._count.sales > 0) {
                return res.status(400).json({
                    error: 'Cannot delete employee with sales history. Archive instead.'
                });
            }
            await prisma_1.prisma.$transaction(async (tx) => {
                await tx.employee.delete({
                    where: { id }
                });
                await tx.user.delete({
                    where: { id: employee.userId }
                });
                await tx.activityLog.create({
                    data: {
                        userId: user.id,
                        action: 'DELETE_EMPLOYEE',
                        entityType: 'EMPLOYEE',
                        entityId: id,
                        details: {
                            employeeName: `${employee.firstName} ${employee.lastName}`,
                            employeeEmail: employee.user.email
                        }
                    }
                });
            });
            res.json({ message: 'Employee deleted successfully' });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to delete employee');
        }
    }
    async deactivateEmployee(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { reason } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    store: true,
                    user: true
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'MANAGER' && employee.storeId !== user.storeId) {
                return res.status(403).json({ error: 'Can only deactivate employees in your store' });
            }
            const updatedUser = await prisma_1.prisma.user.update({
                where: { id: employee.userId },
                data: {}
            });
            await prisma_1.prisma.activityLog.create({
                data: {
                    userId: user.id,
                    action: 'DEACTIVATE_EMPLOYEE',
                    entityType: 'EMPLOYEE',
                    entityId: id,
                    details: {
                        employeeName: `${employee.firstName} ${employee.lastName}`,
                        reason,
                        deactivatedBy: user.email
                    }
                }
            });
            res.json({
                message: 'Employee deactivated successfully',
                employee: {
                    id: employee.id,
                    name: `${employee.firstName} ${employee.lastName}`,
                    email: employee.user.email,
                    deactivatedAt: new Date()
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to deactivate employee');
        }
    }
    async getEmployeePerformance(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { period = 'month' } = req.query;
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true
                        }
                    },
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'CASHIER') {
                const currentEmployee = await prisma_1.prisma.employee.findUnique({
                    where: { userId: user.id }
                });
                if (currentEmployee?.id !== employee.id) {
                    return res.status(403).json({ error: 'Access denied' });
                }
            }
            else if (user.role === 'MANAGER') {
                if (employee.storeId !== user.storeId) {
                    return res.status(403).json({ error: 'Access denied' });
                }
            }
            const endDate = new Date();
            const startDate = new Date();
            switch (period) {
                case 'week':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(startDate.getMonth() - 1);
                    break;
                case 'quarter':
                    startDate.setMonth(startDate.getMonth() - 3);
                    break;
                case 'year':
                    startDate.setFullYear(startDate.getFullYear() - 1);
                    break;
                default:
                    startDate.setMonth(startDate.getMonth() - 1);
            }
            const salesWhere = {
                employeeId: id,
                createdAt: {
                    gte: startDate,
                    lte: endDate
                }
            };
            const [salesSummary, dailySales, topProducts] = await Promise.all([
                prisma_1.prisma.sale.aggregate({
                    where: salesWhere,
                    _sum: { total: true },
                    _count: true,
                    _avg: { total: true },
                    _max: { total: true },
                    _min: { total: true }
                }),
                prisma_1.prisma.$queryRaw `
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as sales_count,
            SUM(total) as total_revenue,
            AVG(total) as average_sale
          FROM sales
          WHERE employee_id = ${id}
            AND created_at >= ${startDate}
            AND created_at <= ${endDate}
          GROUP BY DATE(created_at)
          ORDER BY date
        `,
                prisma_1.prisma.saleItem.groupBy({
                    by: ['productId'],
                    where: {
                        sale: salesWhere
                    },
                    _sum: {
                        quantity: true,
                        price: true
                    },
                    orderBy: {
                        _sum: {
                            quantity: 'desc'
                        }
                    },
                    take: 5
                })
            ]);
            const topProductsWithDetails = await Promise.all(topProducts.map(async (item) => {
                const product = await prisma_1.prisma.product.findUnique({
                    where: { id: item.productId },
                    select: {
                        name: true,
                        type: true
                    }
                });
                return {
                    productId: item.productId,
                    productName: product?.name,
                    productType: product?.type,
                    totalSold: item._sum.quantity,
                    totalRevenue: item._sum.price
                };
            }));
            const recentSales = await prisma_1.prisma.sale.findMany({
                where: salesWhere,
                include: {
                    saleItems: {
                        include: {
                            product: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 10
            });
            res.json({
                employee: {
                    id: employee.id,
                    name: `${employee.user.firstName} ${employee.user.lastName}`,
                    email: employee.user.email,
                    role: employee.user.role,
                    position: employee.position,
                    store: employee.store
                },
                period: {
                    start: startDate,
                    end: endDate,
                    label: period
                },
                performance: {
                    summary: {
                        totalSales: salesSummary._count,
                        totalRevenue: salesSummary._sum.total || 0,
                        averageSale: salesSummary._avg.total || 0,
                        highestSale: salesSummary._max.total || 0,
                        lowestSale: salesSummary._min.total || 0
                    },
                    dailySales,
                    topProducts: topProductsWithDetails,
                    recentSales
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employee performance');
        }
    }
    async resetEmployeePassword(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { sendEmail: sendEmailFlag = true } = req.body;
            if (user.role === 'CASHIER') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id },
                include: {
                    user: true,
                    store: true
                }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'MANAGER' && employee.storeId !== user.storeId) {
                return res.status(403).json({ error: 'Can only reset passwords for employees in your store' });
            }
            const newPassword = crypto_1.default.randomBytes(8).toString('hex');
            const salt = await bcryptjs_1.default.genSalt(10);
            const passwordHash = await bcryptjs_1.default.hash(newPassword, salt);
            await prisma_1.prisma.user.update({
                where: { id: employee.userId },
                data: { passwordHash }
            });
            if (sendEmailFlag) {
                await (0, email_1.sendEmail)({
                    to: employee.user.email,
                    subject: 'Password Reset - Inventory Management System',
                    html: `
            <h1>Password Reset</h1>
            <p>Your password has been reset by an administrator.</p>
            <p><strong>New Password:</strong> ${newPassword}</p>
            <p>Please log in and change your password immediately for security.</p>
            <p>If you did not request this password reset, please contact your administrator immediately.</p>
          `
                });
            }
            await prisma_1.prisma.activityLog.create({
                data: {
                    userId: user.id,
                    action: 'RESET_EMPLOYEE_PASSWORD',
                    entityType: 'EMPLOYEE',
                    entityId: id,
                    details: {
                        employeeName: `${employee.firstName} ${employee.lastName}`,
                        employeeEmail: employee.user.email,
                        resetBy: user.email,
                        emailSent: sendEmailFlag
                    }
                }
            });
            res.json({
                message: sendEmailFlag ? 'Password reset and email sent' : 'Password reset successfully',
                newPassword: sendEmailFlag ? undefined : newPassword
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to reset employee password');
        }
    }
    async getEmployeeActivities(req, res) {
        try {
            const user = req.user;
            const { id } = req.params;
            const { startDate, endDate, action, page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { id }
            });
            if (!employee) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            if (user.role === 'CASHIER') {
                const currentEmployee = await prisma_1.prisma.employee.findUnique({
                    where: { userId: user.id }
                });
                if (currentEmployee?.id !== employee.id) {
                    return res.status(403).json({ error: 'Access denied' });
                }
            }
            else if (user.role === 'MANAGER') {
                if (employee.storeId !== user.storeId) {
                    return res.status(403).json({ error: 'Access denied' });
                }
            }
            let where = {
                userId: employee.userId
            };
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) {
                    where.createdAt.gte = new Date(startDate);
                }
                if (endDate) {
                    where.createdAt.lte = new Date(endDate);
                }
            }
            if (action) {
                where.action = action;
            }
            const [activities, total] = await Promise.all([
                prisma_1.prisma.activityLog.findMany({
                    where,
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum
                }),
                prisma_1.prisma.activityLog.count({ where })
            ]);
            const activitySummary = await prisma_1.prisma.activityLog.groupBy({
                by: ['action'],
                where: {
                    userId: employee.userId,
                    createdAt: {
                        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                    }
                },
                _count: true
            });
            res.json({
                employee: {
                    id: employee.id,
                    name: `${employee.firstName} ${employee.lastName}`
                },
                activities,
                summary: activitySummary,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employee activities');
        }
    }
    async getMyEmployeeData(req, res) {
        try {
            const user = req.user;
            const employee = await prisma_1.prisma.employee.findUnique({
                where: { userId: user.id },
                include: {
                    store: true,
                    user: {
                        select: {
                            email: true,
                            role: true,
                            emailVerified: true,
                            phoneNumber: true
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
                return res.status(404).json({ error: 'Employee record not found' });
            }
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todaySales = await prisma_1.prisma.sale.aggregate({
                where: {
                    employeeId: employee.id,
                    createdAt: { gte: todayStart }
                },
                _sum: { total: true },
                _count: true
            });
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            const monthSales = await prisma_1.prisma.sale.aggregate({
                where: {
                    employeeId: employee.id,
                    createdAt: { gte: monthStart }
                },
                _sum: { total: true },
                _count: true
            });
            res.json({
                employee: {
                    id: employee.id,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    phone: employee.phone,
                    position: employee.position,
                    store: employee.store,
                    user: employee.user,
                    performance: {
                        today: {
                            salesCount: todaySales._count,
                            totalRevenue: todaySales._sum.total || 0
                        },
                        thisMonth: {
                            salesCount: monthSales._count,
                            totalRevenue: monthSales._sum.total || 0
                        },
                        allTime: {
                            salesCount: employee._count.sales
                        }
                    }
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to get employee data');
        }
    }
}
exports.EmployeeController = EmployeeController;
//# sourceMappingURL=employee-controller.js.map