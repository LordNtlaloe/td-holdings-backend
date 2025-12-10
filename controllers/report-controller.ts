// controllers/report.controller.ts
import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { BaseController } from './base-controller';
import { createObjectCsvStringifier } from 'csv-writer';
import PDFDocument from 'pdfkit';

export class ReportController extends BaseController {
    // Generate sales report
    async generateSalesReport(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                startDate,
                endDate,
                storeId,
                employeeId,
                format = 'json',
                groupBy = 'day'
            } = req.query;

            // Parse dates
            const start = startDate ? new Date(startDate as string) : new Date();
            start.setDate(start.getDate() - 30); // Default to last 30 days

            const end = endDate ? new Date(endDate as string) : new Date();

            // Build where clause
            let where: any = {
                createdAt: {
                    gte: start,
                    lte: end
                }
            };

            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            } else if (storeId) {
                where.storeId = storeId as string;
            }

            if (employeeId) {
                where.employeeId = employeeId as string;
            }

            // Get sales data based on grouping
            let reportData: any;
            if (groupBy === 'day') {
                reportData = await this.getDailySalesReport(where);
            } else if (groupBy === 'week') {
                reportData = await this.getWeeklySalesReport(where);
            } else if (groupBy === 'month') {
                reportData = await this.getMonthlySalesReport(where);
            } else if (groupBy === 'product') {
                reportData = await this.getProductSalesReport(where);
            } else if (groupBy === 'employee') {
                reportData = await this.getEmployeeSalesReport(where);
            }

            // Get summary
            const summary = await prisma.sale.aggregate({
                where,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });

            // Format response based on requested format
            if (format === 'csv') {
                return this.generateSalesCSV(res, reportData, summary, { start, end });
            } else if (format === 'pdf') {
                return this.generateSalesPDF(res, reportData, summary, { start, end, user });
            }

            // Default JSON response
            res.json({
                report: {
                    type: 'sales',
                    period: { start, end },
                    groupBy,
                    summary: {
                        totalRevenue: summary._sum.total || 0,
                        totalSales: summary._count,
                        averageSale: summary._avg.total || 0
                    },
                    data: reportData
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to generate sales report');
        }
    }

    // Generate inventory report
    async generateInventoryReport(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                storeId,
                type,
                category,
                lowStockOnly = false,
                format = 'json'
            } = req.query;

            // Build where clause
            let where: any = this.filterByStore(user.role, user.storeId);

            if (storeId && user.role === 'ADMIN') {
                where.storeId = storeId as string;
            }

            if (type) {
                where.type = type;
            }

            if (category && type === 'TIRE') {
                where.tireCategory = category;
            } else if (category && type === 'BALE') {
                where.baleCategory = category;
            }

            if (lowStockOnly === 'true') {
                where.quantity = { lte: 10 };
            }

            // Get inventory data
            const products = await prisma.product.findMany({
                where,
                include: {
                    store: {
                        select: {
                            name: true,
                            location: true
                        }
                    }
                },
                orderBy: [
                    { type: 'asc' },
                    { name: 'asc' }
                ]
            });

            // Get summary
            const summary = await prisma.product.aggregate({
                where,
                _sum: { quantity: true, price: true },
                _count: true,
                _avg: { price: true }
            });

            // Calculate total inventory value
            const totalValue = products.reduce((sum: number, product: { price: number; quantity: number; }) => {
                return sum + (product.price * product.quantity);
            }, 0);

            // Group by type for summary
            const byType = await prisma.product.groupBy({
                by: ['type'],
                where,
                _sum: { quantity: true },
                _count: true
            });

            // Format response
            if (format === 'csv') {
                return this.generateInventoryCSV(res, products, summary, totalValue, byType);
            } else if (format === 'pdf') {
                return this.generateInventoryPDF(res, products, summary, totalValue, byType, { user });
            }

            // Default JSON response
            res.json({
                report: {
                    type: 'inventory',
                    summary: {
                        totalProducts: summary._count,
                        totalStock: summary._sum.quantity || 0,
                        averagePrice: summary._avg.price || 0,
                        totalValue
                    },
                    byType: byType.map((item: { type: any; _count: any; _sum: { quantity: any; }; }) => ({
                        type: item.type,
                        count: item._count,
                        totalStock: item._sum.quantity
                    })),
                    products
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to generate inventory report');
        }
    }

    // Generate employee performance report
    async generateEmployeeReport(req: AuthRequest, res: Response) {
        try {
            const user = req.user!;
            const {
                storeId,
                startDate,
                endDate,
                format = 'json'
            } = req.query;

            // Parse dates
            const start = startDate ? new Date(startDate as string) : new Date();
            start.setMonth(start.getMonth() - 1); // Default to last month

            const end = endDate ? new Date(endDate as string) : new Date();

            // Get employees based on user role
            let employeesWhere: any = {};
            if (user.role !== 'ADMIN') {
                employeesWhere.storeId = user.storeId;
            } else if (storeId) {
                employeesWhere.storeId = storeId as string;
            }

            const employees = await prisma.employee.findMany({
                where: employeesWhere,
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

            // Get sales data for each employee
            const employeeReports = await Promise.all(
                employees.map(async (employee: { id: any; user: { firstName: any; lastName: any; email: any; role: any; }; position: any; store: any; }) => {
                    const salesWhere = {
                        employeeId: employee.id,
                        createdAt: {
                            gte: start,
                            lte: end
                        }
                    };

                    const [salesSummary, recentSales] = await Promise.all([
                        prisma.sale.aggregate({
                            where: salesWhere,
                            _sum: { total: true },
                            _count: true,
                            _avg: { total: true }
                        }),
                        prisma.sale.findMany({
                            where: salesWhere,
                            orderBy: { createdAt: 'desc' },
                            take: 5,
                            include: {
                                saleItems: {
                                    include: {
                                        product: true
                                    }
                                }
                            }
                        })
                    ]);

                    return {
                        employeeId: employee.id,
                        name: `${employee.user.firstName} ${employee.user.lastName}`,
                        email: employee.user.email,
                        role: employee.user.role,
                        position: employee.position,
                        store: employee.store,
                        summary: {
                            totalSales: salesSummary._count,
                            totalRevenue: salesSummary._sum.total || 0,
                            averageSale: salesSummary._avg.total || 0
                        },
                        recentSales
                    };
                })
            );

            // Sort by total revenue
            employeeReports.sort((a: { summary: { totalRevenue: number; }; }, b: { summary: { totalRevenue: number; }; }) => b.summary.totalRevenue - a.summary.totalRevenue);

            // Format response
            if (format === 'csv') {
                return this.generateEmployeeCSV(res, employeeReports, { start, end });
            } else if (format === 'pdf') {
                return this.generateEmployeePDF(res, employeeReports, { start, end, user });
            }

            // Default JSON response
            res.json({
                report: {
                    type: 'employee_performance',
                    period: { start, end },
                    employees: employeeReports
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to generate employee report');
        }
    }

    // Private helper methods for report generation
    private async getDailySalesReport(where: any) {
        return await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma.sql`AND store_id = ${where.storeId}` : prisma.sql``}
        ${where.employeeId ? prisma.sql`AND employee_id = ${where.employeeId}` : prisma.sql``}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
    }

    private async getWeeklySalesReport(where: any) {
        return await prisma.$queryRaw`
      SELECT 
        YEAR(created_at) as year,
        WEEK(created_at) as week,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma.sql`AND store_id = ${where.storeId}` : prisma.sql``}
        ${where.employeeId ? prisma.sql`AND employee_id = ${where.employeeId}` : prisma.sql``}
      GROUP BY YEAR(created_at), WEEK(created_at)
      ORDER BY year DESC, week DESC
    `;
    }

    private async getMonthlySalesReport(where: any) {
        return await prisma.$queryRaw`
      SELECT 
        YEAR(created_at) as year,
        MONTH(created_at) as month,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma.sql`AND store_id = ${where.storeId}` : prisma.sql``}
        ${where.employeeId ? prisma.sql`AND employee_id = ${where.employeeId}` : prisma.sql``}
      GROUP BY YEAR(created_at), MONTH(created_at)
      ORDER BY year DESC, month DESC
    `;
    }

    private async getProductSalesReport(where: any) {
        const productSales = await prisma.saleItem.groupBy({
            by: ['productId'],
            where: {
                sale: where
            },
            _sum: {
                quantity: true,
                price: true
            },
            _count: true
        });

        // Get product details
        const productIds = productSales.map((item: { productId: any; }) => item.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
                id: true,
                name: true,
                type: true,
                grade: true,
                price: true
            }
        });

        return productSales.map((item: { productId: any; _sum: { quantity: any; price: any; }; _count: any; }) => {
            const product = products.find((p: { id: any; }) => p.id === item.productId);
            return {
                productId: item.productId,
                productName: product?.name || 'Unknown',
                productType: product?.type,
                productGrade: product?.grade,
                currentPrice: product?.price,
                totalSold: item._sum.quantity,
                totalRevenue: item._sum.price,
                saleCount: item._count
            };
        });
    }

    private async getEmployeeSalesReport(where: any) {
        const employeeSales = await prisma.sale.groupBy({
            by: ['employeeId'],
            where,
            _sum: { total: true },
            _count: true,
            _avg: { total: true }
        });

        // Get employee details
        const employeeIds = employeeSales.map((item: { employeeId: any; }) => item.employeeId);
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
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

        return employeeSales.map((item: { employeeId: any; _count: any; _sum: { total: any; }; _avg: { total: any; }; }) => {
            const employee = employees.find((e: { id: any; }) => e.id === item.employeeId);
            return {
                employeeId: item.employeeId,
                employeeName: employee ? `${employee.user.firstName} ${employee.user.lastName}` : 'Unknown',
                employeeEmail: employee?.user.email,
                storeName: employee?.store.name,
                totalSales: item._count,
                totalRevenue: item._sum.total,
                averageSale: item._avg.total
            };
        });
    }

    // CSV Generation Methods
    private generateSalesCSV(res: Response, data: any, summary: any, period: any) {
        const csvStringifier = createObjectCsvStringifier({
            header: [
                { id: 'date', title: 'DATE' },
                { id: 'sales_count', title: 'SALES_COUNT' },
                { id: 'total_revenue', title: 'TOTAL_REVENUE' },
                { id: 'average_sale', title: 'AVERAGE_SALE' }
            ]
        });

        const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(data);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
    }

    private generateInventoryCSV(res: Response, products: any, summary: any, totalValue: number, byType: any) {
        const csvStringifier = createObjectCsvStringifier({
            header: [
                { id: 'name', title: 'PRODUCT_NAME' },
                { id: 'type', title: 'TYPE' },
                { id: 'grade', title: 'GRADE' },
                { id: 'quantity', title: 'QUANTITY' },
                { id: 'price', title: 'PRICE' },
                { id: 'total_value', title: 'TOTAL_VALUE' },
                { id: 'store', title: 'STORE' }
            ]
        });

        const records = products.map((product: any) => ({
            name: product.name,
            type: product.type,
            grade: product.grade,
            quantity: product.quantity,
            price: product.price,
            total_value: product.price * product.quantity,
            store: product.store.name
        }));

        const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=inventory-report-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
    }

    private generateEmployeeCSV(res: Response, employees: any, period: any) {
        const csvStringifier = createObjectCsvStringifier({
            header: [
                { id: 'name', title: 'EMPLOYEE_NAME' },
                { id: 'email', title: 'EMAIL' },
                { id: 'position', title: 'POSITION' },
                { id: 'total_sales', title: 'TOTAL_SALES' },
                { id: 'total_revenue', title: 'TOTAL_REVENUE' },
                { id: 'average_sale', title: 'AVERAGE_SALE' },
                { id: 'store', title: 'STORE' }
            ]
        });

        const records = employees.map((emp: any) => ({
            name: emp.name,
            email: emp.email,
            position: emp.position,
            total_sales: emp.summary.totalSales,
            total_revenue: emp.summary.totalRevenue,
            average_sale: emp.summary.averageSale,
            store: emp.store.name
        }));

        const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=employee-report-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
    }

    // PDF Generation Methods
    private generateSalesPDF(res: Response, data: any, summary: any, options: any) {
        const doc = new PDFDocument();

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.pdf`);

        // Pipe PDF to response
        doc.pipe(res);

        // Add content to PDF
        doc.fontSize(20).text('Sales Report', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Period: ${options.start.toLocaleDateString()} to ${options.end.toLocaleDateString()}`);
        doc.text(`Generated by: ${options.user.email}`);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
        doc.moveDown();

        doc.text('Summary:', { underline: true });
        doc.text(`Total Revenue: $${summary._sum.total?.toFixed(2) || '0.00'}`);
        doc.text(`Total Sales: ${summary._count}`);
        doc.text(`Average Sale: $${summary._avg.total?.toFixed(2) || '0.00'}`);
        doc.moveDown();

        // Add table headers
        doc.text('Date\t\tSales Count\tTotal Revenue\tAverage Sale', { underline: true });

        // Add table rows
        data.forEach((row: any) => {
            const date = row.date || `${row.year}-${row.month}` || `${row.year}-W${row.week}`;
            doc.text(`${date}\t\t${row.sales_count}\t\t$${row.total_revenue?.toFixed(2) || '0.00'}\t\t$${row.average_sale?.toFixed(2) || '0.00'}`);
        });

        doc.end();
    }

    private generateInventoryPDF(res: Response, products: any, summary: any, totalValue: number, byType: any, options: any) {
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=inventory-report-${new Date().toISOString().split('T')[0]}.pdf`);

        doc.pipe(res);

        doc.fontSize(20).text('Inventory Report', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Generated by: ${options.user.email}`);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
        doc.moveDown();

        doc.text('Summary:', { underline: true });
        doc.text(`Total Products: ${summary._count}`);
        doc.text(`Total Stock: ${summary._sum.quantity || 0}`);
        doc.text(`Average Price: $${summary._avg.price?.toFixed(2) || '0.00'}`);
        doc.text(`Total Inventory Value: $${totalValue.toFixed(2)}`);
        doc.moveDown();

        // Add product list
        doc.text('Products:', { underline: true });
        doc.moveDown(0.5);

        products.forEach((product: any, index: number) => {
            doc.text(`${index + 1}. ${product.name} (${product.type})`);
            doc.text(`   Quantity: ${product.quantity} | Price: $${product.price} | Value: $${(product.price * product.quantity).toFixed(2)}`);
            doc.moveDown(0.5);
        });

        doc.end();
    }

    private generateEmployeePDF(res: Response, employees: any, options: any) {
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=employee-report-${new Date().toISOString().split('T')[0]}.pdf`);

        doc.pipe(res);

        doc.fontSize(20).text('Employee Performance Report', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Period: ${options.start.toLocaleDateString()} to ${options.end.toLocaleDateString()}`);
        doc.text(`Generated by: ${options.user.email}`);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
        doc.moveDown();

        // Add employee performance
        employees.forEach((emp: any, index: number) => {
            doc.text(`${index + 1}. ${emp.name} (${emp.position})`, { underline: true });
            doc.text(`   Email: ${emp.email}`);
            doc.text(`   Store: ${emp.store.name}`);
            doc.text(`   Total Sales: ${emp.summary.totalSales}`);
            doc.text(`   Total Revenue: $${emp.summary.totalRevenue.toFixed(2)}`);
            doc.text(`   Average Sale: $${emp.summary.averageSale.toFixed(2)}`);
            doc.moveDown();
        });

        doc.end();
    }
}