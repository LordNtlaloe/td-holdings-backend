"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportController = void 0;
const prisma_1 = require("../lib/prisma");
const base_controller_1 = require("./base-controller");
const csv_writer_1 = require("csv-writer");
const pdfkit_1 = __importDefault(require("pdfkit"));
class ReportController extends base_controller_1.BaseController {
    async generateSalesReport(req, res) {
        try {
            const user = req.user;
            const { startDate, endDate, storeId, employeeId, format = 'json', groupBy = 'day' } = req.query;
            const start = startDate ? new Date(startDate) : new Date();
            start.setDate(start.getDate() - 30);
            const end = endDate ? new Date(endDate) : new Date();
            let where = {
                createdAt: {
                    gte: start,
                    lte: end
                }
            };
            if (user.role !== 'ADMIN') {
                where.storeId = user.storeId;
            }
            else if (storeId) {
                where.storeId = storeId;
            }
            if (employeeId) {
                where.employeeId = employeeId;
            }
            let reportData;
            if (groupBy === 'day') {
                reportData = await this.getDailySalesReport(where);
            }
            else if (groupBy === 'week') {
                reportData = await this.getWeeklySalesReport(where);
            }
            else if (groupBy === 'month') {
                reportData = await this.getMonthlySalesReport(where);
            }
            else if (groupBy === 'product') {
                reportData = await this.getProductSalesReport(where);
            }
            else if (groupBy === 'employee') {
                reportData = await this.getEmployeeSalesReport(where);
            }
            const summary = await prisma_1.prisma.sale.aggregate({
                where,
                _sum: { total: true },
                _count: true,
                _avg: { total: true }
            });
            if (format === 'csv') {
                return this.generateSalesCSV(res, reportData, summary, { start, end });
            }
            else if (format === 'pdf') {
                return this.generateSalesPDF(res, reportData, summary, { start, end, user });
            }
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
        }
        catch (error) {
            this.handleError(res, error, 'Failed to generate sales report');
        }
    }
    async generateInventoryReport(req, res) {
        try {
            const user = req.user;
            const { storeId, type, category, lowStockOnly = false, format = 'json' } = req.query;
            let where = this.filterByStore(user.role, user.storeId);
            if (storeId && user.role === 'ADMIN') {
                where.storeId = storeId;
            }
            if (type) {
                where.type = type;
            }
            if (category && type === 'TIRE') {
                where.tireCategory = category;
            }
            else if (category && type === 'BALE') {
                where.baleCategory = category;
            }
            if (lowStockOnly === 'true') {
                where.quantity = { lte: 10 };
            }
            const products = await prisma_1.prisma.product.findMany({
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
            const summary = await prisma_1.prisma.product.aggregate({
                where,
                _sum: { quantity: true, price: true },
                _count: true,
                _avg: { price: true }
            });
            const totalValue = products.reduce((sum, product) => {
                return sum + (product.price * product.quantity);
            }, 0);
            const byType = await prisma_1.prisma.product.groupBy({
                by: ['type'],
                where,
                _sum: { quantity: true },
                _count: true
            });
            if (format === 'csv') {
                return this.generateInventoryCSV(res, products, summary, totalValue, byType);
            }
            else if (format === 'pdf') {
                return this.generateInventoryPDF(res, products, summary, totalValue, byType, { user });
            }
            res.json({
                report: {
                    type: 'inventory',
                    summary: {
                        totalProducts: summary._count,
                        totalStock: summary._sum.quantity || 0,
                        averagePrice: summary._avg.price || 0,
                        totalValue
                    },
                    byType: byType.map(item => ({
                        type: item.type,
                        count: item._count,
                        totalStock: item._sum.quantity
                    })),
                    products
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to generate inventory report');
        }
    }
    async generateEmployeeReport(req, res) {
        try {
            const user = req.user;
            const { storeId, startDate, endDate, format = 'json' } = req.query;
            const start = startDate ? new Date(startDate) : new Date();
            start.setMonth(start.getMonth() - 1);
            const end = endDate ? new Date(endDate) : new Date();
            let employeesWhere = {};
            if (user.role !== 'ADMIN') {
                employeesWhere.storeId = user.storeId;
            }
            else if (storeId) {
                employeesWhere.storeId = storeId;
            }
            const employees = await prisma_1.prisma.employee.findMany({
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
            const employeeReports = await Promise.all(employees.map(async (employee) => {
                const salesWhere = {
                    employeeId: employee.id,
                    createdAt: {
                        gte: start,
                        lte: end
                    }
                };
                const [salesSummary, recentSales] = await Promise.all([
                    prisma_1.prisma.sale.aggregate({
                        where: salesWhere,
                        _sum: { total: true },
                        _count: true,
                        _avg: { total: true }
                    }),
                    prisma_1.prisma.sale.findMany({
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
            }));
            employeeReports.sort((a, b) => b.summary.totalRevenue - a.summary.totalRevenue);
            if (format === 'csv') {
                return this.generateEmployeeCSV(res, employeeReports, { start, end });
            }
            else if (format === 'pdf') {
                return this.generateEmployeePDF(res, employeeReports, { start, end, user });
            }
            res.json({
                report: {
                    type: 'employee_performance',
                    period: { start, end },
                    employees: employeeReports
                }
            });
        }
        catch (error) {
            this.handleError(res, error, 'Failed to generate employee report');
        }
    }
    async getDailySalesReport(where) {
        return await prisma_1.prisma.$queryRaw `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma_1.prisma.sql `AND store_id = ${where.storeId}` : prisma_1.prisma.sql ``}
        ${where.employeeId ? prisma_1.prisma.sql `AND employee_id = ${where.employeeId}` : prisma_1.prisma.sql ``}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
    }
    async getWeeklySalesReport(where) {
        return await prisma_1.prisma.$queryRaw `
      SELECT 
        YEAR(created_at) as year,
        WEEK(created_at) as week,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma_1.prisma.sql `AND store_id = ${where.storeId}` : prisma_1.prisma.sql ``}
        ${where.employeeId ? prisma_1.prisma.sql `AND employee_id = ${where.employeeId}` : prisma_1.prisma.sql ``}
      GROUP BY YEAR(created_at), WEEK(created_at)
      ORDER BY year DESC, week DESC
    `;
    }
    async getMonthlySalesReport(where) {
        return await prisma_1.prisma.$queryRaw `
      SELECT 
        YEAR(created_at) as year,
        MONTH(created_at) as month,
        COUNT(*) as sales_count,
        SUM(total) as total_revenue,
        AVG(total) as average_sale
      FROM sales
      WHERE created_at >= ${where.createdAt.gte} 
        AND created_at <= ${where.createdAt.lte}
        ${where.storeId ? prisma_1.prisma.sql `AND store_id = ${where.storeId}` : prisma_1.prisma.sql ``}
        ${where.employeeId ? prisma_1.prisma.sql `AND employee_id = ${where.employeeId}` : prisma_1.prisma.sql ``}
      GROUP BY YEAR(created_at), MONTH(created_at)
      ORDER BY year DESC, month DESC
    `;
    }
    async getProductSalesReport(where) {
        const productSales = await prisma_1.prisma.saleItem.groupBy({
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
        const productIds = productSales.map(item => item.productId);
        const products = await prisma_1.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
                id: true,
                name: true,
                type: true,
                grade: true,
                price: true
            }
        });
        return productSales.map(item => {
            const product = products.find(p => p.id === item.productId);
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
    async getEmployeeSalesReport(where) {
        const employeeSales = await prisma_1.prisma.sale.groupBy({
            by: ['employeeId'],
            where,
            _sum: { total: true },
            _count: true,
            _avg: { total: true }
        });
        const employeeIds = employeeSales.map(item => item.employeeId);
        const employees = await prisma_1.prisma.employee.findMany({
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
        return employeeSales.map(item => {
            const employee = employees.find(e => e.id === item.employeeId);
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
    generateSalesCSV(res, data, summary, period) {
        const csvStringifier = (0, csv_writer_1.createObjectCsvStringifier)({
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
    generateInventoryCSV(res, products, summary, totalValue, byType) {
        const csvStringifier = (0, csv_writer_1.createObjectCsvStringifier)({
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
        const records = products.map((product) => ({
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
    generateEmployeeCSV(res, employees, period) {
        const csvStringifier = (0, csv_writer_1.createObjectCsvStringifier)({
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
        const records = employees.map((emp) => ({
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
    generateSalesPDF(res, data, summary, options) {
        const doc = new pdfkit_1.default();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.pdf`);
        doc.pipe(res);
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
        doc.text('Date\t\tSales Count\tTotal Revenue\tAverage Sale', { underline: true });
        data.forEach((row) => {
            const date = row.date || `${row.year}-${row.month}` || `${row.year}-W${row.week}`;
            doc.text(`${date}\t\t${row.sales_count}\t\t$${row.total_revenue?.toFixed(2) || '0.00'}\t\t$${row.average_sale?.toFixed(2) || '0.00'}`);
        });
        doc.end();
    }
    generateInventoryPDF(res, products, summary, totalValue, byType, options) {
        const doc = new pdfkit_1.default();
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
        doc.text('Products:', { underline: true });
        doc.moveDown(0.5);
        products.forEach((product, index) => {
            doc.text(`${index + 1}. ${product.name} (${product.type})`);
            doc.text(`   Quantity: ${product.quantity} | Price: $${product.price} | Value: $${(product.price * product.quantity).toFixed(2)}`);
            doc.moveDown(0.5);
        });
        doc.end();
    }
    generateEmployeePDF(res, employees, options) {
        const doc = new pdfkit_1.default();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=employee-report-${new Date().toISOString().split('T')[0]}.pdf`);
        doc.pipe(res);
        doc.fontSize(20).text('Employee Performance Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Period: ${options.start.toLocaleDateString()} to ${options.end.toLocaleDateString()}`);
        doc.text(`Generated by: ${options.user.email}`);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`);
        doc.moveDown();
        employees.forEach((emp, index) => {
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
exports.ReportController = ReportController;
//# sourceMappingURL=report-controller.js.map