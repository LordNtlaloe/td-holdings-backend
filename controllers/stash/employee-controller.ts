// // controllers/employee.controller.ts
// import { Response } from 'express';
// import { prisma } from '../../lib/prisma';
// import { AuthRequest } from '../../middleware/auth';
// import { BaseController } from './base-controller';
// import bcrypt from 'bcryptjs';
// import crypto from 'crypto';
// import { sendEmail } from '../../utils/email';

// export class EmployeeController extends BaseController {
//     // Create employee (Admin/Manager only)
//     async createEmployee(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const {
//                 firstName,
//                 lastName,
//                 email,
//                 phone,
//                 position,
//                 storeId,
//                 role = 'CASHIER',
//                 sendInvitation = true
//             } = req.body;

//             // Check permissions
//             if (user.role === 'CASHIER') {
//                 return res.status(403).json({ error: 'Insufficient permissions' });
//             }

//             if (user.role === 'MANAGER') {
//                 // Managers can only create employees for their store
//                 if (storeId && storeId !== user.storeId) {
//                     return res.status(403).json({ error: 'Can only create employees for your store' });
//                 }
//             }

//             // Determine store ID
//             const targetStoreId = storeId || (user.role === 'MANAGER' ? user.storeId : null);
//             if (!targetStoreId) {
//                 return res.status(400).json({ error: 'Store ID is required' });
//             }

//             // Check if store exists
//             const store = await prisma.store.findUnique({
//                 where: { id: targetStoreId }
//             });

//             if (!store) {
//                 return res.status(404).json({ error: 'Store not found' });
//             }

//             // Check if email already exists
//             const existingUser = await prisma.user.findUnique({
//                 where: { email }
//             });

//             if (existingUser) {
//                 return res.status(400).json({ error: 'Email already registered' });
//             }

//             // Generate temporary password
//             const tempPassword = crypto.randomBytes(8).toString('hex');
//             const salt = await bcrypt.genSalt(10);
//             const passwordHash = await bcrypt.hash(tempPassword, salt);

//             // Create user and employee in transaction
//             const result = await prisma.$transaction(async (tx) => {
//                 // Create user
//                 const newUser = await tx.user.create({
//                     data: {
//                         firstName,
//                         lastName,
//                         email,
//                         passwordHash,
//                         phoneNumber: phone || '',
//                         role
//                     }
//                 });

//                 // Create employee
//                 const employee = await tx.employee.create({
//                     data: {
//                         firstName,
//                         lastName,
//                         phone: phone || '',
//                         position: position || 'Clerk',
//                         storeId: targetStoreId,
//                         userId: newUser.id
//                     },
//                     include: {
//                         store: true,
//                         user: {
//                             select: {
//                                 email: true,
//                                 role: true,
//                                 emailVerified: true
//                             }
//                         }
//                     }
//                 });

//                 // Create verification code if sending invitation
//                 if (sendInvitation) {
//                     const verificationCode = crypto.randomInt(100000, 999999).toString();
//                     await tx.verificationCode.create({
//                         data: {
//                             userId: newUser.id,
//                             code: verificationCode,
//                             expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
//                         }
//                     });

//                     // Send invitation email
//                     await sendEmail({
//                         to: email,
//                         subject: 'Welcome to Inventory Management System',
//                         html: `
//               <h1>Welcome ${firstName}!</h1>
//               <p>Your account has been created with the following details:</p>
//               <ul>
//                 <li><strong>Email:</strong> ${email}</li>
//                 <li><strong>Temporary Password:</strong> ${tempPassword}</li>
//                 <li><strong>Role:</strong> ${role}</li>
//                 <li><strong>Store:</strong> ${store.name} (${store.location})</li>
//                 <li><strong>Position:</strong> ${position || 'Clerk'}</li>
//               </ul>
//               <p>Please log in and change your password immediately.</p>
//               ${role !== 'CASHIER' ? `<p><strong>Note:</strong> As a ${role}, you have additional permissions to manage store operations.</p>` : ''}
//               <p>Verification Code: <strong>${verificationCode}</strong></p>
//               <p>This code will expire in 7 days.</p>
//             `
//                     });
//                 }

//                 return { user: newUser, employee };
//             });

//             res.status(201).json({
//                 message: sendInvitation ? 'Employee created and invitation sent' : 'Employee created successfully',
//                 employee: {
//                     id: result.employee.id,
//                     firstName: result.employee.firstName,
//                     lastName: result.employee.lastName,
//                     phone: result.employee.phone,
//                     position: result.employee.position,
//                     store: result.employee.store,
//                     user: {
//                         email: result.employee.user.email,
//                         role: result.employee.user.role,
//                         emailVerified: result.employee.user.emailVerified
//                     },
//                     temporaryPassword: sendInvitation ? tempPassword : undefined
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to create employee');
//         }
//     }

//     // Get all employees (with filtering)
//     async getEmployees(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const {
//                 storeId,
//                 role,
//                 position,
//                 search,
//                 page = 1,
//                 limit = 20,
//                 sortBy = 'createdAt',
//                 sortOrder = 'desc'
//             } = req.query;

//             const pageNum = parseInt(page as string);
//             const limitNum = parseInt(limit as string);
//             const skip = (pageNum - 1) * limitNum;

//             // Build where clause for employees
//             let where: any = {};

//             // Store filter based on user role
//             if (user.role === 'MANAGER') {
//                 where.storeId = user.storeId;
//             } else if (user.role === 'ADMIN' && storeId) {
//                 where.storeId = storeId as string;
//             } else if (user.role === 'CASHIER') {
//                 // Cashiers can only see themselves
//                 const employee = await prisma.employee.findUnique({
//                     where: { userId: user.id }
//                 });
//                 if (employee) {
//                     where.id = employee.id;
//                 } else {
//                     return res.json({
//                         employees: [],
//                         pagination: {
//                             page: 1,
//                             limit: 20,
//                             total: 0,
//                             pages: 0
//                         }
//                     });
//                 }
//             }

//             // Position filter
//             if (position) {
//                 where.position = position;
//             }

//             // Role filter - add to user relation
//             if (role) {
//                 where.user = {
//                     role: role as string
//                 };
//             }

//             // Search filter
//             if (search) {
//                 const searchString = search as string;
//                 where.OR = [
//                     { firstName: { contains: searchString, mode: 'insensitive' } },
//                     { lastName: { contains: searchString, mode: 'insensitive' } },
//                     { phone: { contains: searchString, mode: 'insensitive' } },
//                     { user: { email: { contains: searchString, mode: 'insensitive' } } }
//                 ];
//             }

//             // Get employees with user data
//             const [employees, total] = await Promise.all([
//                 prisma.employee.findMany({
//                     where,
//                     include: {
//                         store: {
//                             select: {
//                                 name: true,
//                                 location: true
//                             }
//                         },
//                         user: {
//                             select: {
//                                 email: true,
//                                 role: true,
//                                 emailVerified: true,
//                                 createdAt: true
//                             }
//                         },
//                         _count: {
//                             select: {
//                                 sales: true
//                             }
//                         }
//                     },
//                     orderBy: { [sortBy as string]: sortOrder },
//                     skip,
//                     take: limitNum
//                 }),
//                 prisma.employee.count({ where })
//             ]);

//             res.json({
//                 employees: employees.map(emp => ({
//                     id: emp.id,
//                     firstName: emp.firstName,
//                     lastName: emp.lastName,
//                     phone: emp.phone,
//                     position: emp.position,
//                     store: emp.store,
//                     user: emp.user,
//                     salesCount: emp._count.sales,
//                     createdAt: emp.createdAt,
//                     updatedAt: emp.updatedAt
//                 })),
//                 pagination: {
//                     page: pageNum,
//                     limit: limitNum,
//                     total,
//                     pages: Math.ceil(total / limitNum)
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to get employees');
//         }
//     }

//     // Get employee by ID
//     async getEmployeeById(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;

//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     store: true,
//                     user: {
//                         select: {
//                             email: true,
//                             role: true,
//                             emailVerified: true,
//                             createdAt: true,
//                             updatedAt: true
//                         }
//                     },
//                     sales: {
//                         include: {
//                             saleItems: {
//                                 include: {
//                                     product: true
//                                 }
//                             }
//                         },
//                         orderBy: {
//                             createdAt: 'desc'
//                         },
//                         take: 10
//                     },
//                     _count: {
//                         select: {
//                             sales: true
//                         }
//                     }
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             // Check access permissions
//             if (user.role === 'CASHIER') {
//                 const currentEmployee = await prisma.employee.findUnique({
//                     where: { userId: user.id }
//                 });
//                 if (currentEmployee?.id !== employee.id) {
//                     return res.status(403).json({ error: 'Access denied to this employee' });
//                 }
//             } else if (user.role === 'MANAGER') {
//                 if (employee.storeId !== user.storeId) {
//                     return res.status(403).json({ error: 'Access denied to this employee' });
//                 }
//             }

//             // Calculate employee performance metrics
//             const thirtyDaysAgo = new Date();
//             thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//             const recentSales = await prisma.sale.aggregate({
//                 where: {
//                     employeeId: employee.id,
//                     createdAt: { gte: thirtyDaysAgo }
//                 },
//                 _sum: { total: true },
//                 _count: true,
//                 _avg: { total: true }
//             });

//             const performance = {
//                 last30Days: {
//                     totalSales: recentSales._count,
//                     totalRevenue: recentSales._sum.total || 0,
//                     averageSale: recentSales._avg.total || 0
//                 },
//                 allTime: {
//                     totalSales: employee._count.sales
//                 }
//             };

//             res.json({
//                 employee: {
//                     id: employee.id,
//                     firstName: employee.firstName,
//                     lastName: employee.lastName,
//                     phone: employee.phone,
//                     position: employee.position,
//                     store: employee.store,
//                     user: employee.user,
//                     performance,
//                     recentSales: employee.sales,
//                     createdAt: employee.createdAt,
//                     updatedAt: employee.updatedAt
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to get employee');
//         }
//     }

//     // Update employee (Admin/Manager only)
//     async updateEmployee(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;
//             const { firstName, lastName, phone, position, storeId, role } = req.body;

//             // Get employee to check permissions
//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     store: true,
//                     user: true
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             // Check permissions
//             if (user.role === 'CASHIER') {
//                 return res.status(403).json({ error: 'Insufficient permissions' });
//             }

//             if (user.role === 'MANAGER') {
//                 // Managers can only update employees in their store
//                 if (employee.storeId !== user.storeId) {
//                     return res.status(403).json({ error: 'Can only update employees in your store' });
//                 }
//                 // Managers cannot change store or role
//                 if (storeId || role) {
//                     return res.status(403).json({ error: 'Managers cannot change store or role' });
//                 }
//             }

//             // Prepare update data
//             const employeeUpdateData: any = {};
//             const userUpdateData: any = {};

//             if (firstName !== undefined) {
//                 employeeUpdateData.firstName = firstName;
//                 userUpdateData.firstName = firstName;
//             }

//             if (lastName !== undefined) {
//                 employeeUpdateData.lastName = lastName;
//                 userUpdateData.lastName = lastName;
//             }

//             if (phone !== undefined) employeeUpdateData.phone = phone;
//             if (position !== undefined) employeeUpdateData.position = position;
//             if (storeId !== undefined && user.role === 'ADMIN') employeeUpdateData.storeId = storeId;
//             if (role !== undefined && user.role === 'ADMIN') userUpdateData.role = role;

//             // Update in transaction
//             const updatedEmployee = await prisma.$transaction(async (tx) => {
//                 // Update employee
//                 const emp = await tx.employee.update({
//                     where: { id },
//                     data: employeeUpdateData,
//                     include: {
//                         store: true
//                     }
//                 });

//                 // Update user if there are user updates
//                 if (Object.keys(userUpdateData).length > 0) {
//                     await tx.user.update({
//                         where: { id: employee.userId },
//                         data: userUpdateData
//                     });
//                 }

//                 // Get updated user data
//                 const updatedUser = await tx.user.findUnique({
//                     where: { id: employee.userId },
//                     select: {
//                         email: true,
//                         role: true,
//                         emailVerified: true
//                     }
//                 });

//                 return { ...emp, user: updatedUser };
//             });

//             res.json({
//                 message: 'Employee updated successfully',
//                 employee: updatedEmployee
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to update employee');
//         }
//     }

//     // Delete employee (Admin only)
//     async deleteEmployee(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;

//             if (user.role !== 'ADMIN') {
//                 return res.status(403).json({ error: 'Only admins can delete employees' });
//             }

//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     user: true,
//                     _count: {
//                         select: {
//                             sales: true
//                         }
//                     }
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             // Check if employee has sales
//             if (employee._count.sales > 0) {
//                 return res.status(400).json({
//                     error: 'Cannot delete employee with sales history. Archive instead.'
//                 });
//             }

//             // Delete in transaction
//             await prisma.$transaction(async (tx) => {
//                 // Delete employee
//                 await tx.employee.delete({
//                     where: { id }
//                 });

//                 // Delete user (cascade should handle this, but explicit for clarity)
//                 await tx.user.delete({
//                     where: { id: employee.userId }
//                 });

//                 // Log activity
//                 await tx.activityLog.create({
//                     data: {
//                         userId: user.id,
//                         action: 'DELETE_EMPLOYEE',
//                         entityType: 'EMPLOYEE',
//                         entityId: id,
//                         details: {
//                             employeeName: `${employee.firstName} ${employee.lastName}`,
//                             employeeEmail: employee.user.email
//                         }
//                     }
//                 });
//             });

//             res.json({ message: 'Employee deleted successfully' });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to delete employee');
//         }
//     }

//     // Deactivate employee (Admin/Manager)
//     async deactivateEmployee(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;
//             const { reason } = req.body;

//             // Check permissions
//             if (user.role === 'CASHIER') {
//                 return res.status(403).json({ error: 'Insufficient permissions' });
//             }

//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     store: true,
//                     user: true
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             if (user.role === 'MANAGER' && employee.storeId !== user.storeId) {
//                 return res.status(403).json({ error: 'Can only deactivate employees in your store' });
//             }

//             // Update user to be inactive (assuming we have an isActive field)
//             // If not, we should add it to the User model
//             const updatedUser = await prisma.user.update({
//                 where: { id: employee.userId },
//                 data: {
//                     isActive: false
//                 }
//             });

//             // Log deactivation
//             await prisma.activityLog.create({
//                 data: {
//                     userId: user.id,
//                     action: 'DEACTIVATE_EMPLOYEE',
//                     entityType: 'EMPLOYEE',
//                     entityId: id,
//                     details: {
//                         employeeName: `${employee.firstName} ${employee.lastName}`,
//                         reason,
//                         deactivatedBy: user.email
//                     }
//                 }
//             });

//             res.json({
//                 message: 'Employee deactivated successfully',
//                 employee: {
//                     id: employee.id,
//                     name: `${employee.firstName} ${employee.lastName}`,
//                     email: employee.user.email,
//                     deactivatedAt: new Date()
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to deactivate employee');
//         }
//     }

//     // Get employee performance metrics
//     async getEmployeePerformance(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;
//             const { period = 'month' } = req.query;

//             // Get employee
//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     user: {
//                         select: {
//                             firstName: true,
//                             lastName: true,
//                             email: true,
//                             role: true
//                         }
//                     },
//                     store: {
//                         select: {
//                             name: true,
//                             location: true
//                         }
//                     }
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             // Check access permissions
//             if (user.role === 'CASHIER') {
//                 const currentEmployee = await prisma.employee.findUnique({
//                     where: { userId: user.id }
//                 });
//                 if (currentEmployee?.id !== employee.id) {
//                     return res.status(403).json({ error: 'Access denied' });
//                 }
//             } else if (user.role === 'MANAGER') {
//                 if (employee.storeId !== user.storeId) {
//                     return res.status(403).json({ error: 'Access denied' });
//                 }
//             }

//             // Calculate date range
//             const endDate = new Date();
//             const startDate = new Date();

//             switch (period) {
//                 case 'week':
//                     startDate.setDate(startDate.getDate() - 7);
//                     break;
//                 case 'month':
//                     startDate.setMonth(startDate.getMonth() - 1);
//                     break;
//                 case 'quarter':
//                     startDate.setMonth(startDate.getMonth() - 3);
//                     break;
//                 case 'year':
//                     startDate.setFullYear(startDate.getFullYear() - 1);
//                     break;
//                 default:
//                     startDate.setMonth(startDate.getMonth() - 1);
//             }

//             // Get sales data
//             const salesWhere = {
//                 employeeId: id,
//                 createdAt: {
//                     gte: startDate,
//                     lte: endDate
//                 }
//             };

//             const [salesSummary, dailySales, topProducts] = await Promise.all([
//                 // Summary statistics
//                 prisma.sale.aggregate({
//                     where: salesWhere,
//                     _sum: { total: true },
//                     _count: true,
//                     _avg: { total: true },
//                     _max: { total: true },
//                     _min: { total: true }
//                 }),

//                 // Daily sales for chart
//                 prisma.$queryRaw`
//           SELECT 
//             DATE(created_at) as date,
//             COUNT(*) as sales_count,
//             SUM(total) as total_revenue,
//             AVG(total) as average_sale
//           FROM sales
//           WHERE employee_id = ${id}
//             AND created_at >= ${startDate}
//             AND created_at <= ${endDate}
//           GROUP BY DATE(created_at)
//           ORDER BY date
//         `,

//                 // Top selling products
//                 prisma.saleItem.groupBy({
//                     by: ['productId'],
//                     where: {
//                         sale: salesWhere
//                     },
//                     _sum: {
//                         quantity: true,
//                         price: true
//                     },
//                     orderBy: {
//                         _sum: {
//                             quantity: 'desc'
//                         }
//                     },
//                     take: 5
//                 })
//             ]);

//             // Get product details for top products
//             const topProductsWithDetails = await Promise.all(
//                 topProducts.map(async (item) => {
//                     const product = await prisma.product.findUnique({
//                         where: { id: item.productId },
//                         select: {
//                             name: true,
//                             type: true
//                         }
//                     });
//                     return {
//                         productId: item.productId,
//                         productName: product?.name,
//                         productType: product?.type,
//                         totalSold: item._sum.quantity,
//                         totalRevenue: item._sum.price
//                     };
//                 })
//             );

//             // Get recent sales
//             const recentSales = await prisma.sale.findMany({
//                 where: salesWhere,
//                 include: {
//                     saleItems: {
//                         include: {
//                             product: true
//                         }
//                     }
//                 },
//                 orderBy: { createdAt: 'desc' },
//                 take: 10
//             });

//             res.json({
//                 employee: {
//                     id: employee.id,
//                     name: `${employee.user.firstName} ${employee.user.lastName}`,
//                     email: employee.user.email,
//                     role: employee.user.role,
//                     position: employee.position,
//                     store: employee.store
//                 },
//                 period: {
//                     start: startDate,
//                     end: endDate,
//                     label: period
//                 },
//                 performance: {
//                     summary: {
//                         totalSales: salesSummary._count,
//                         totalRevenue: salesSummary._sum.total || 0,
//                         averageSale: salesSummary._avg.total || 0,
//                         highestSale: salesSummary._max.total || 0,
//                         lowestSale: salesSummary._min.total || 0
//                     },
//                     dailySales,
//                     topProducts: topProductsWithDetails,
//                     recentSales
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to get employee performance');
//         }
//     }

//     // Reset employee password (Admin/Manager only)
//     async resetEmployeePassword(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;
//             const { sendEmail: sendEmailFlag = true } = req.body;

//             // Check permissions
//             if (user.role === 'CASHIER') {
//                 return res.status(403).json({ error: 'Insufficient permissions' });
//             }

//             const employee = await prisma.employee.findUnique({
//                 where: { id },
//                 include: {
//                     user: true,
//                     store: true
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             if (user.role === 'MANAGER' && employee.storeId !== user.storeId) {
//                 return res.status(403).json({ error: 'Can only reset passwords for employees in your store' });
//             }

//             // Generate new password
//             const newPassword = crypto.randomBytes(8).toString('hex');
//             const salt = await bcrypt.genSalt(10);
//             const passwordHash = await bcrypt.hash(newPassword, salt);

//             // Update password
//             await prisma.user.update({
//                 where: { id: employee.userId },
//                 data: { passwordHash }
//             });

//             // Send email notification
//             if (sendEmailFlag) {
//                 await sendEmail({
//                     to: employee.user.email,
//                     subject: 'Password Reset - Inventory Management System',
//                     html: `
//             <h1>Password Reset</h1>
//             <p>Your password has been reset by an administrator.</p>
//             <p><strong>New Password:</strong> ${newPassword}</p>
//             <p>Please log in and change your password immediately for security.</p>
//             <p>If you did not request this password reset, please contact your administrator immediately.</p>
//           `
//                 });
//             }

//             // Log activity
//             await prisma.activityLog.create({
//                 data: {
//                     userId: user.id,
//                     action: 'RESET_EMPLOYEE_PASSWORD',
//                     entityType: 'EMPLOYEE',
//                     entityId: id,
//                     details: {
//                         employeeName: `${employee.firstName} ${employee.lastName}`,
//                         employeeEmail: employee.user.email,
//                         resetBy: user.email,
//                         emailSent: sendEmailFlag
//                     }
//                 }
//             });

//             res.json({
//                 message: sendEmailFlag ? 'Password reset and email sent' : 'Password reset successfully',
//                 newPassword: sendEmailFlag ? undefined : newPassword // Only return password if email not sent
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to reset employee password');
//         }
//     }

//     // Get employee activities (for monitoring)
//     async getEmployeeActivities(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const { id } = req.params;
//             const {
//                 startDate,
//                 endDate,
//                 action,
//                 page = 1,
//                 limit = 20
//             } = req.query;

//             const pageNum = parseInt(page as string);
//             const limitNum = parseInt(limit as string);
//             const skip = (pageNum - 1) * limitNum;

//             // Get employee
//             const employee = await prisma.employee.findUnique({
//                 where: { id }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee not found' });
//             }

//             // Check access permissions
//             if (user.role === 'CASHIER') {
//                 const currentEmployee = await prisma.employee.findUnique({
//                     where: { userId: user.id }
//                 });
//                 if (currentEmployee?.id !== employee.id) {
//                     return res.status(403).json({ error: 'Access denied' });
//                 }
//             } else if (user.role === 'MANAGER') {
//                 if (employee.storeId !== user.storeId) {
//                     return res.status(403).json({ error: 'Access denied' });
//                 }
//             }

//             // Build where clause for activities
//             let where: any = {
//                 userId: employee.userId
//             };

//             // Date filter
//             if (startDate || endDate) {
//                 where.createdAt = {};
//                 if (startDate) {
//                     where.createdAt.gte = new Date(startDate as string);
//                 }
//                 if (endDate) {
//                     where.createdAt.lte = new Date(endDate as string);
//                 }
//             }

//             // Action filter
//             if (action) {
//                 where.action = action;
//             }

//             // Get activities
//             const [activities, total] = await Promise.all([
//                 prisma.activityLog.findMany({
//                     where,
//                     include: {
//                         user: {
//                             select: {
//                                 firstName: true,
//                                 lastName: true,
//                                 email: true
//                             }
//                         }
//                     },
//                     orderBy: { createdAt: 'desc' },
//                     skip,
//                     take: limitNum
//                 }),
//                 prisma.activityLog.count({ where })
//             ]);

//             // Get activity summary
//             const activitySummary = await prisma.activityLog.groupBy({
//                 by: ['action'],
//                 where: {
//                     userId: employee.userId,
//                     createdAt: {
//                         gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
//                     }
//                 },
//                 _count: true
//             });

//             res.json({
//                 employee: {
//                     id: employee.id,
//                     name: `${employee.firstName} ${employee.lastName}`
//                 },
//                 activities,
//                 summary: activitySummary,
//                 pagination: {
//                     page: pageNum,
//                     limit: limitNum,
//                     total,
//                     pages: Math.ceil(total / limitNum)
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to get employee activities');
//         }
//     }

//     // Get current employee's own data
//     async getMyEmployeeData(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;

//             const employee = await prisma.employee.findUnique({
//                 where: { userId: user.id },
//                 include: {
//                     store: true,
//                     user: {
//                         select: {
//                             email: true,
//                             role: true,
//                             emailVerified: true,
//                             phoneNumber: true
//                         }
//                     },
//                     _count: {
//                         select: {
//                             sales: true
//                         }
//                     }
//                 }
//             });

//             if (!employee) {
//                 return res.status(404).json({ error: 'Employee record not found' });
//             }

//             // Get today's sales
//             const todayStart = new Date();
//             todayStart.setHours(0, 0, 0, 0);

//             const todaySales = await prisma.sale.aggregate({
//                 where: {
//                     employeeId: employee.id,
//                     createdAt: { gte: todayStart }
//                 },
//                 _sum: { total: true },
//                 _count: true
//             });

//             // Get this month's sales
//             const monthStart = new Date();
//             monthStart.setDate(1);
//             monthStart.setHours(0, 0, 0, 0);

//             const monthSales = await prisma.sale.aggregate({
//                 where: {
//                     employeeId: employee.id,
//                     createdAt: { gte: monthStart }
//                 },
//                 _sum: { total: true },
//                 _count: true
//             });

//             res.json({
//                 employee: {
//                     id: employee.id,
//                     firstName: employee.firstName,
//                     lastName: employee.lastName,
//                     phone: employee.phone,
//                     position: employee.position,
//                     store: employee.store,
//                     user: employee.user,
//                     performance: {
//                         today: {
//                             salesCount: todaySales._count,
//                             totalRevenue: todaySales._sum.total || 0
//                         },
//                         thisMonth: {
//                             salesCount: monthSales._count,
//                             totalRevenue: monthSales._sum.total || 0
//                         },
//                         allTime: {
//                             salesCount: employee._count.sales
//                         }
//                     }
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to get employee data');
//         }
//     }
// }