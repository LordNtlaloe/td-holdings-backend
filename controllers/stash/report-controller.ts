// // controllers/report.controller.ts
// import { Response } from 'express';
// import { prisma } from '../../lib/prisma';
// import { AuthRequest } from '../../middleware/auth';
// import { BaseController } from './base-controller';
// import { createObjectCsvStringifier } from 'csv-writer';
// import PDFDocument from 'pdfkit';
// import { Prisma } from '@prisma/client';

// export class ReportController extends BaseController {
//     // Generate sales report
//     async generateSalesReport(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const {
//                 startDate,
//                 endDate,
//                 storeId,
//                 employeeId,
//                 format = 'json',
//                 groupBy = 'day'
//             } = req.query;

//             // Parse dates
//             const start = startDate ? new Date(startDate as string) : new Date();
//             start.setDate(start.getDate() - 30); // Default to last 30 days

//             const end = endDate ? new Date(endDate as string) : new Date();

//             // Build where clause
//             const where: Prisma.SaleWhereInput = {
//                 createdAt: {
//                     gte: start,
//                     lte: end
//                 }
//             };

//             if (user.role !== 'ADMIN') {
//                 where.storeId = user.storeId;
//             } else if (storeId) {
//                 where.storeId = storeId as string;
//             }

//             if (employeeId) {
//                 where.employeeId = employeeId as string;
//             }

//             // Get sales data based on grouping
//             let reportData: any;
//             if (groupBy === 'day') {
//                 reportData = await this.getDailySalesReport(where);
//             } else if (groupBy === 'week') {
//                 reportData = await this.getWeeklySalesReport(where);
//             } else if (groupBy === 'month') {
//                 reportData = await this.getMonthlySalesReport(where);
//             } else if (groupBy === 'product') {
//                 reportData = await this.getProductSalesReport(where);
//             } else if (groupBy === 'employee') {
//                 reportData = await this.getEmployeeSalesReport(where);
//             }

//             // Get summary
//             const summary = await prisma.sale.aggregate({
//                 where,
//                 _sum: { total: true },
//                 _count: true,
//                 _avg: { total: true }
//             });

//             // Format response based on requested format
//             if (format === 'csv') {
//                 return this.generateSalesCSV(res, reportData, summary, { start, end });
//             } else if (format === 'pdf') {
//                 return this.generateSalesPDF(res, reportData, summary, { start, end, user });
//             }

//             // Default JSON response
//             res.json({
//                 report: {
//                     type: 'sales',
//                     period: { start, end },
//                     groupBy,
//                     summary: {
//                         totalRevenue: summary._sum.total || 0,
//                         totalSales: summary._count,
//                         averageSale: summary._avg.total || 0
//                     },
//                     data: reportData
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to generate sales report');
//         }
//     }

//     // Generate inventory report
//     async generateInventoryReport(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const {
//                 storeId,
//                 type,
//                 category,
//                 lowStockOnly = false,
//                 format = 'json'
//             } = req.query;

//             // Build where clause
//             let where: Prisma.ProductWhereInput = {};

//             // Filter by store based on user role
//             if (user.role !== 'ADMIN') {
//                 where.storeId = user.storeId;
//             } else if (storeId) {
//                 where.storeId = storeId as string;
//             }

//             if (type) {
//                 where.type = type as any;
//             }

//             if (category) {
//                 if (type === 'TIRE') {
//                     // where.tireCategory = category;
//                 } else if (type === 'BALE') {
//                     // where.baleCategory = category;
//                 }
//             }

//             if (lowStockOnly === 'true') {
//                 where.quantity = { lte: 10 };
//             }

//             // Get inventory data
//             const products = await prisma.product.findMany({
//                 where,
//                 include: {
//                     store: {
//                         select: {
//                             name: true,
//                             location: true
//                         }
//                     }
//                 },
//                 orderBy: [
//                     { type: 'asc' },
//                     { name: 'asc' }
//                 ]
//             });

//             // Get summary
//             const summary = await prisma.product.aggregate({
//                 where,
//                 _sum: { quantity: true, price: true },
//                 _count: true,
//                 _avg: { price: true }
//             });

//             // Calculate total inventory value
//             const totalValue = products.reduce((sum, product) => {
//                 return sum + (product.price * product.quantity);
//             }, 0);

//             // Group by type for summary
//             const byType = await prisma.product.groupBy({
//                 by: ['type'],
//                 where,
//                 _sum: { quantity: true },
//                 _count: true
//             });

//             // Format response
//             if (format === 'csv') {
//                 return this.generateInventoryCSV(res, products, summary, totalValue, byType);
//             } else if (format === 'pdf') {
//                 return this.generateInventoryPDF(res, products, summary, totalValue, byType, { user });
//             }

//             // Default JSON response
//             res.json({
//                 report: {
//                     type: 'inventory',
//                     summary: {
//                         totalProducts: summary._count,
//                         totalStock: summary._sum.quantity || 0,
//                         averagePrice: summary._avg.price || 0,
//                         totalValue
//                     },
//                     byType: byType.map(item => ({
//                         type: item.type,
//                         count: item._count,
//                         totalStock: item._sum.quantity || 0
//                     })),
//                     products
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to generate inventory report');
//         }
//     }

//     // Generate employee performance report
//     async generateEmployeeReport(req: AuthRequest, res: Response) {
//         try {
//             const user = req.user!;
//             const {
//                 storeId,
//                 startDate,
//                 endDate,
//                 format = 'json'
//             } = req.query;

//             // Parse dates
//             const start = startDate ? new Date(startDate as string) : new Date();
//             start.setMonth(start.getMonth() - 1); // Default to last month

//             const end = endDate ? new Date(endDate as string) : new Date();

//             // Get employees based on user role
//             let employeesWhere: Prisma.EmployeeWhereInput = {};
//             if (user.role !== 'ADMIN') {
//                 employeesWhere.storeId = user.storeId;
//             } else if (storeId) {
//                 employeesWhere.storeId = storeId as string;
//             }

//             const employees = await prisma.employee.findMany({
//                 where: employeesWhere,
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

//             // Get sales data for each employee
//             const employeeReports = await Promise.all(
//                 employees.map(async (employee) => {
//                     const salesWhere: Prisma.SaleWhereInput = {
//                         employeeId: employee.id,
//                         createdAt: {
//                             gte: start,
//                             lte: end
//                         }
//                     };

//                     const [salesSummary, recentSales] = await Promise.all([
//                         prisma.sale.aggregate({
//                             where: salesWhere,
//                             _sum: { total: true },
//                             _count: true,
//                             _avg: { total: true }
//                         }),
//                         prisma.sale.findMany({
//                             where: salesWhere,
//                             orderBy: { createdAt: 'desc' },
//                             take: 5,
//                             include: {
//                                 saleItems: {
//                                     include: {
//                                         product: true
//                                     }
//                                 }
//                             }
//                         })
//                     ]);

//                     return {
//                         employeeId: employee.id,
//                         name: `${employee.user.firstName} ${employee.user.lastName}`,
//                         email: employee.user.email,
//                         role: employee.user.role,
//                         position: employee.position,
//                         store: employee.store,
//                         summary: {
//                             totalSales: salesSummary._count,
//                             totalRevenue: salesSummary._sum.total || 0,
//                             averageSale: salesSummary._avg.total || 0
//                         },
//                         recentSales
//                     };
//                 })
//             );

//             // Sort by total revenue
//             employeeReports.sort((a, b) => b.summary.totalRevenue - a.summary.totalRevenue);

//             // Format response
//             if (format === 'csv') {
//                 return this.generateEmployeeCSV(res, employeeReports, { start, end });
//             } else if (format === 'pdf') {
//                 return this.generateEmployeePDF(res, employeeReports, { start, end, user });
//             }

//             // Default JSON response
//             res.json({
//                 report: {
//                     type: 'employee_performance',
//                     period: { start, end },
//                     employees: employeeReports
//                 }
//             });
//         } catch (error) {
//             this.handleError(res, error, 'Failed to generate employee report');
//         }
//     }

//     // Private helper methods for report generation
//     private async getDailySalesReport(where: Prisma.SaleWhereInput) {
//         // Get all sales in the date range
//         const sales = await prisma.sale.findMany({
//             where,
//             select: {
//                 createdAt: true,
//                 total: true,
//                 storeId: true,
//                 employeeId: true
//             },
//             orderBy: {
//                 createdAt: 'asc'
//             }
//         });

//         // Group by date manually
//         const salesByDate = new Map<string, {
//             salesCount: number;
//             totalRevenue: number;
//             sales: typeof sales;
//         }>();

//         sales.forEach(sale => {
//             const dateKey = sale.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD

//             if (!salesByDate.has(dateKey)) {
//                 salesByDate.set(dateKey, {
//                     salesCount: 0,
//                     totalRevenue: 0,
//                     sales: []
//                 });
//             }

//             const dayData = salesByDate.get(dateKey)!;
//             dayData.salesCount++;
//             dayData.totalRevenue += Number(sale.total);
//             dayData.sales.push(sale);
//         });

//         // Convert to array format
//         return Array.from(salesByDate.entries()).map(([date, data]) => ({
//             date: new Date(date),
//             sales_count: data.salesCount,
//             total_revenue: data.totalRevenue,
//             average_sale: data.salesCount > 0 ? data.totalRevenue / data.salesCount : 0
//         })).sort((a, b) => b.date.getTime() - a.date.getTime());
//     }

//     private async getWeeklySalesReport(where: Prisma.SaleWhereInput) {
//         // Get all sales in the date range
//         const sales = await prisma.sale.findMany({
//             where,
//             select: {
//                 createdAt: true,
//                 total: true
//             },
//             orderBy: {
//                 createdAt: 'asc'
//             }
//         });

//         // Group by week manually
//         const salesByWeek = new Map<string, {
//             year: number;
//             week: number;
//             salesCount: number;
//             totalRevenue: number;
//         }>();

//         sales.forEach(sale => {
//             const date = sale.createdAt;
//             const year = date.getFullYear();

//             // Calculate week number
//             const firstDayOfYear = new Date(year, 0, 1);
//             const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
//             const week = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

//             const weekKey = `${year}-${week}`;

//             if (!salesByWeek.has(weekKey)) {
//                 salesByWeek.set(weekKey, {
//                     year,
//                     week,
//                     salesCount: 0,
//                     totalRevenue: 0
//                 });
//             }

//             const weekData = salesByWeek.get(weekKey)!;
//             weekData.salesCount++;
//             weekData.totalRevenue += Number(sale.total);
//         });

//         // Convert to array format
//         return Array.from(salesByWeek.values()).map(data => ({
//             year: data.year,
//             week: data.week,
//             sales_count: data.salesCount,
//             total_revenue: data.totalRevenue,
//             average_sale: data.salesCount > 0 ? data.totalRevenue / data.salesCount : 0
//         })).sort((a, b) => {
//             if (a.year !== b.year) return b.year - a.year;
//             return b.week - a.week;
//         });
//     }

//     private async getMonthlySalesReport(where: Prisma.SaleWhereInput) {
//         // Get all sales in the date range
//         const sales = await prisma.sale.findMany({
//             where,
//             select: {
//                 createdAt: true,
//                 total: true
//             },
//             orderBy: {
//                 createdAt: 'asc'
//             }
//         });

//         // Group by month manually
//         const salesByMonth = new Map<string, {
//             year: number;
//             month: number;
//             salesCount: number;
//             totalRevenue: number;
//         }>();

//         sales.forEach(sale => {
//             const date = sale.createdAt;
//             const year = date.getFullYear();
//             const month = date.getMonth() + 1; // getMonth() returns 0-11

//             const monthKey = `${year}-${month}`;

//             if (!salesByMonth.has(monthKey)) {
//                 salesByMonth.set(monthKey, {
//                     year,
//                     month,
//                     salesCount: 0,
//                     totalRevenue: 0
//                 });
//             }

//             const monthData = salesByMonth.get(monthKey)!;
//             monthData.salesCount++;
//             monthData.totalRevenue += Number(sale.total);
//         });

//         // Convert to array format
//         return Array.from(salesByMonth.values()).map(data => ({
//             year: data.year,
//             month: data.month,
//             sales_count: data.salesCount,
//             total_revenue: data.totalRevenue,
//             average_sale: data.salesCount > 0 ? data.totalRevenue / data.salesCount : 0
//         })).sort((a, b) => {
//             if (a.year !== b.year) return b.year - a.year;
//             return b.month - a.month;
//         });
//     }

//     private async getProductSalesReport(where: Prisma.SaleWhereInput) {
//         const productSales = await prisma.saleItem.groupBy({
//             by: ['productId'],
//             where: {
//                 sale: where
//             },
//             _sum: {
//                 quantity: true,
//                 price: true
//             },
//             _count: true
//         });

//         // Get product details
//         const productIds = productSales.map(item => item.productId);
//         const products = await prisma.product.findMany({
//             where: { id: { in: productIds } },
//             select: {
//                 id: true,
//                 name: true,
//                 type: true,
//                 grade: true,
//                 price: true
//             }
//         });

//         return productSales.map(item => {
//             const product = products.find(p => p.id === item.productId);
//             return {
//                 productId: item.productId,
//                 productName: product?.name || 'Unknown',
//                 productType: product?.type,
//                 productGrade: product?.grade,
//                 currentPrice: product?.price,
//                 totalSold: item._sum.quantity || 0,
//                 totalRevenue: item._sum.price || 0,
//                 saleCount: item._count
//             };
//         });
//     }

//     private async getEmployeeSalesReport(where: Prisma.SaleWhereInput) {
//         const employeeSales = await prisma.sale.groupBy({
//             by: ['employeeId'],
//             where,
//             _sum: { total: true },
//             _count: true,
//             _avg: { total: true }
//         });

//         // Get employee details
//         const employeeIds = employeeSales.map(item => item.employeeId);
//         const employees = await prisma.employee.findMany({
//             where: { id: { in: employeeIds } },
//             include: {
//                 user: {
//                     select: {
//                         firstName: true,
//                         lastName: true,
//                         email: true
//                     }
//                 },
//                 store: {
//                     select: {
//                         name: true,
//                         location: true
//                     }
//                 }
//             }
//         });

//         return employeeSales.map(item => {
//             const employee = employees.find(e => e.id === item.employeeId);
//             return {
//                 employeeId: item.employeeId,
//                 employeeName: employee ? `${employee.user.firstName} ${employee.user.lastName}` : 'Unknown',
//                 employeeEmail: employee?.user.email,
//                 storeName: employee?.store.name,
//                 totalSales: item._count,
//                 totalRevenue: item._sum.total || 0,
//                 averageSale: item._avg.total || 0
//             };
//         });
//     }

//     // CSV Generation Methods
//     private generateSalesCSV(res: Response, data: any[], summary: any, period: any) {
//         const csvStringifier = createObjectCsvStringifier({
//             header: [
//                 { id: 'date', title: 'DATE' },
//                 { id: 'sales_count', title: 'SALES_COUNT' },
//                 { id: 'total_revenue', title: 'TOTAL_REVENUE' },
//                 { id: 'average_sale', title: 'AVERAGE_SALE' }
//             ]
//         });

//         // Format data for CSV
//         const csvData = data.map(item => {
//             let dateStr = '';
//             if (item.date) {
//                 dateStr = item.date.toISOString().split('T')[0];
//             } else if (item.year && item.month) {
//                 dateStr = `${item.year}-${item.month.toString().padStart(2, '0')}`;
//             } else if (item.year && item.week) {
//                 dateStr = `${item.year}-W${item.week.toString().padStart(2, '0')}`;
//             }

//             return {
//                 date: dateStr,
//                 sales_count: item.sales_count,
//                 total_revenue: item.total_revenue,
//                 average_sale: item.average_sale
//             };
//         });

//         const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(csvData);

//         res.setHeader('Content-Type', 'text/csv');
//         res.setHeader('Content-Disposition', `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.csv`);
//         res.send(csvContent);
//     }

//     private generateInventoryCSV(res: Response, products: any[], summary: any, totalValue: number, byType: any) {
//         const csvStringifier = createObjectCsvStringifier({
//             header: [
//                 { id: 'name', title: 'PRODUCT_NAME' },
//                 { id: 'type', title: 'TYPE' },
//                 { id: 'grade', title: 'GRADE' },
//                 { id: 'quantity', title: 'QUANTITY' },
//                 { id: 'price', title: 'PRICE' },
//                 { id: 'total_value', title: 'TOTAL_VALUE' },
//                 { id: 'store', title: 'STORE' }
//             ]
//         });

//         const records = products.map((product: any) => ({
//             name: product.name,
//             type: product.type,
//             grade: product.grade,
//             quantity: product.quantity,
//             price: product.price,
//             total_value: product.price * product.quantity,
//             store: product.store.name
//         }));

//         const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

//         res.setHeader('Content-Type', 'text/csv');
//         res.setHeader('Content-Disposition', `attachment; filename=inventory-report-${new Date().toISOString().split('T')[0]}.csv`);
//         res.send(csvContent);
//     }

//     private generateEmployeeCSV(res: Response, employees: any[], period: any) {
//         const csvStringifier = createObjectCsvStringifier({
//             header: [
//                 { id: 'name', title: 'EMPLOYEE_NAME' },
//                 { id: 'email', title: 'EMAIL' },
//                 { id: 'position', title: 'POSITION' },
//                 { id: 'total_sales', title: 'TOTAL_SALES' },
//                 { id: 'total_revenue', title: 'TOTAL_REVENUE' },
//                 { id: 'average_sale', title: 'AVERAGE_SALE' },
//                 { id: 'store', title: 'STORE' }
//             ]
//         });

//         const records = employees.map((emp: any) => ({
//             name: emp.name,
//             email: emp.email,
//             position: emp.position,
//             total_sales: emp.summary.totalSales,
//             total_revenue: emp.summary.totalRevenue,
//             average_sale: emp.summary.averageSale,
//             store: emp.store.name
//         }));

//         const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

//         res.setHeader('Content-Type', 'text/csv');
//         res.setHeader('Content-Disposition', `attachment; filename=employee-report-${new Date().toISOString().split('T')[0]}.csv`);
//         res.send(csvContent);
//     }

//     // PDF Generation Methods
//     private generateSalesPDF(res: Response, data: any[], summary: any, options: any) {
//         const doc = new PDFDocument();

//         // Set response headers
//         res.setHeader('Content-Type', 'application/pdf');
//         res.setHeader('Content-Disposition', `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.pdf`);

//         // Pipe PDF to response
//         doc.pipe(res);

//         // Add content to PDF
//         doc.fontSize(20).text('Sales Report', { align: 'center' });
//         doc.moveDown();

//         doc.fontSize(12).text(`Period: ${options.start.toLocaleDateString()} to ${options.end.toLocaleDateString()}`);
//         doc.text(`Generated by: ${options.user.email}`);
//         doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
//         doc.moveDown();

//         doc.text('Summary:', { underline: true });
//         doc.text(`Total Revenue: $${summary._sum.total?.toFixed(2) || '0.00'}`);
//         doc.text(`Total Sales: ${summary._count}`);
//         doc.text(`Average Sale: $${summary._avg.total?.toFixed(2) || '0.00'}`);
//         doc.moveDown();

//         // Add table headers
//         doc.text('Date\t\tSales Count\tTotal Revenue\tAverage Sale', { underline: true });

//         // Add table rows
//         data.forEach((row: any) => {
//             let date = '';
//             if (row.date) {
//                 date = row.date.toISOString().split('T')[0];
//             } else if (row.year && row.month) {
//                 date = `${row.year}-${row.month}`;
//             } else if (row.year && row.week) {
//                 date = `${row.year}-W${row.week}`;
//             }

//             doc.text(`${date}\t\t${row.sales_count}\t\t$${(row.total_revenue || 0).toFixed(2)}\t\t$${(row.average_sale || 0).toFixed(2)}`);
//         });

//         doc.end();
//     }

//     private generateInventoryPDF(res: Response, products: any[], summary: any, totalValue: number, byType: any[], options: any) {
//         const doc = new PDFDocument();

//         res.setHeader('Content-Type', 'application/pdf');
//         res.setHeader('Content-Disposition', `attachment; filename=inventory-report-${new Date().toISOString().split('T')[0]}.pdf`);

//         doc.pipe(res);

//         doc.fontSize(20).text('Inventory Report', { align: 'center' });
//         doc.moveDown();

//         doc.fontSize(12).text(`Generated by: ${options.user.email}`);
//         doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
//         doc.moveDown();

//         doc.text('Summary:', { underline: true });
//         doc.text(`Total Products: ${summary._count}`);
//         doc.text(`Total Stock: ${summary._sum.quantity || 0}`);
//         doc.text(`Average Price: $${(summary._avg.price || 0).toFixed(2)}`);
//         doc.text(`Total Inventory Value: $${totalValue.toFixed(2)}`);
//         doc.moveDown();

//         // Add product list
//         doc.text('Products:', { underline: true });
//         doc.moveDown(0.5);

//         products.forEach((product: any, index: number) => {
//             doc.text(`${index + 1}. ${product.name} (${product.type})`);
//             doc.text(`   Quantity: ${product.quantity} | Price: $${product.price} | Value: $${(product.price * product.quantity).toFixed(2)}`);
//             doc.moveDown(0.5);
//         });

//         doc.end();
//     }

//     private generateEmployeePDF(res: Response, employees: any[], options: any) {
//         const doc = new PDFDocument();

//         res.setHeader('Content-Type', 'application/pdf');
//         res.setHeader('Content-Disposition', `attachment; filename=employee-report-${new Date().toISOString().split('T')[0]}.pdf`);

//         doc.pipe(res);

//         doc.fontSize(20).text('Employee Performance Report', { align: 'center' });
//         doc.moveDown();

//         doc.fontSize(12).text(`Period: ${options.start.toLocaleDateString()} to ${options.end.toLocaleDateString()}`);
//         doc.text(`Generated by: ${options.user.email}`);
//         doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
//         doc.moveDown();

//         // Add employee performance
//         employees.forEach((emp: any, index: number) => {
//             doc.text(`${index + 1}. ${emp.name} (${emp.position})`, { underline: true });
//             doc.text(`   Email: ${emp.email}`);
//             doc.text(`   Store: ${emp.store.name}`);
//             doc.text(`   Total Sales: ${emp.summary.totalSales}`);
//             doc.text(`   Total Revenue: $${(emp.summary.totalRevenue || 0).toFixed(2)}`);
//             doc.text(`   Average Sale: $${(emp.summary.averageSale || 0).toFixed(2)}`);
//             doc.moveDown();
//         });

//         doc.end();
//     }
// }