// types/analytics.ts

import { Request } from 'express';

// Authentication
export interface AuthenticatedRequest extends Request {
    user: {
        id: string;
        email: string;
        role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
        storeId?: string;
    };
}

// Query Parameters
export interface SalesAnalyticsQuery {
    startDate?: string;
    endDate?: string;
    storeId?: string;
    groupBy?: 'day' | 'product' | 'employee';
    productType?: string;
    employeeId?: string;
}

export interface InventoryAnalyticsQuery {
    storeId?: string;
    category?: string;
    minStock?: string;
    maxStock?: string;
}

// Daily Sales Data
export interface DailySalesData {
    date: Date;
    sales_count: number;
    total_revenue: number;
    average_sale: number;
    items_sold: number;
    active_employees: number;
}

// Product Analytics Data
export interface ProductAnalyticsData {
    productId: string;
    productName: string;
    productType: string | null;
    productGrade: string | null;
    currentPrice: number;
    totalSold: number;
    totalRevenue: number;
    saleCount: number;
    averagePerSale: number;
}

// Employee Analytics Data
export interface EmployeeAnalyticsData {
    employeeId: string;
    employeeName: string;
    employeeEmail: string | null;
    storeName: string | null;
    storeLocation: string | null;
    totalSales: number;
    totalRevenue: number;
    averageSale: number;
    performanceScore: number;
}

// Sales Analytics Response
export interface SalesAnalyticsResponse {
    analytics: {
        groupBy: 'day' | 'product' | 'employee';
        data: DailySalesData[] | ProductAnalyticsData[] | EmployeeAnalyticsData[];
        summary: {
            totalRevenue: number;
            totalSales: number;
            averageSale: number;
            highestSale: number;
            lowestSale: number;
            salesGrowth: number;
            revenueGrowth: number;
        };
        filters: {
            dateRange: {
                start?: Date;
                end?: Date;
            };
            storeId?: string;
            employeeId?: string;
            productType?: string;
        };
    };
}

// Inventory Types
export interface ProductWithStore {
    id: string;
    name: string;
    type: string;
    grade: string;
    price: number;
    quantity: number;
    store: {
        name: string;
        location: string;
    };
}

export interface StockDistribution {
    type: string;
    count: number;
    totalStock: number;
}

export interface GradeDistribution {
    grade: string;
    count: number;
    totalStock: number;
}

export interface ValueAnalysis {
    stockLevel: string;
    productCount: number;
    totalValue: number;
    avgPrice: number;
}

export interface TurnoverAnalysis {
    productId: string;
    productName: string;
    currentStock: number;
    monthlySales: number;
    turnoverRate: number;
    restockUrgency: 'high' | 'medium' | 'low';
    daysUntilStockout: number | null;
}

// Inventory Analytics Response
export interface InventoryAnalyticsResponse {
    summary: {
        totalProducts: number;
        totalStock: number;
        averagePrice: number;
        averageStock: number;
        totalValue: number;
        lowStockCount: number;
        outOfStockCount: number;
    };
    distribution: {
        byType: StockDistribution[];
        byGrade: GradeDistribution[];
    };
    valueAnalysis: ValueAnalysis[];
    turnoverAnalysis: TurnoverAnalysis[];
    alerts: {
        lowStock: ProductWithStore[];
        outOfStock: ProductWithStore[];
        highTurnover: TurnoverAnalysis[];
    };
}