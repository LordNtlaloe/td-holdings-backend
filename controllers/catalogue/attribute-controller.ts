import { prisma } from "../../lib/prisma";

/**
 * CATALOG ATTRIBUTE CONTROLLER: Product attribute and category management
 * 
 * Manages: Product types, grades, tire categories, etc.
 * These are mostly enums but could be extended to dynamic attributes
 */

/**
 * Get all product attributes (enums)
 * Used for dropdowns and form validation
 */
export const getAllProductAttributes = async (): Promise<{
    productTypes: string[];
    productGrades: string[];
    tireCategories: string[];
    tireUsages: string[];
    roles: string[];
    paymentMethods: string[];
    transferStatuses: string[];
    inventoryChangeTypes: string[];
}> => {
    // These come from Prisma enums
    return {
        productTypes: Object.values(require('@prisma/client').ProductType),
        productGrades: Object.values(require('@prisma/client').ProductGrade),
        tireCategories: Object.values(require('@prisma/client').TireCategory),
        tireUsages: Object.values(require('@prisma/client').TireUsage),
        roles: Object.values(require('@prisma/client').Role),
        paymentMethods: Object.values(require('@prisma/client').PaymentMethodType),
        transferStatuses: Object.values(require('@prisma/client').TransferStatus),
        inventoryChangeTypes: Object.values(require('@prisma/client').InventoryChangeType)
    };
};

/**
 * Get product statistics by category
 * 
 * @param groupBy Group by field (type, grade, tireCategory, etc.)
 */
export const getProductStatistics = async (
    groupBy: 'type' | 'grade' | 'tireCategory' | 'tireUsage'
): Promise<Array<{
    category: string;
    count: number;
    totalInventory: number;
    averagePrice: number;
}>> => {
    const products = await prisma.product.findMany({
        include: {
            inventories: {
                select: {
                    quantity: true
                }
            }
        }
    });

    // Group products
    const groups: Record<string, any> = {};

    products.forEach(product => {
        let categoryValue: string;

        switch (groupBy) {
            case 'type':
                categoryValue = product.type;
                break;
            case 'grade':
                categoryValue = product.grade;
                break;
            case 'tireCategory':
                categoryValue = product.tireCategory || 'UNCATEGORIZED';
                break;
            case 'tireUsage':
                categoryValue = product.tireUsage || 'UNCATEGORIZED';
                break;
            default:
                categoryValue = 'UNKNOWN';
        }

        if (!groups[categoryValue]) {
            groups[categoryValue] = {
                category: categoryValue,
                count: 0,
                totalInventory: 0,
                totalPrice: 0
            };
        }

        groups[categoryValue].count++;
        groups[categoryValue].totalInventory += product.inventories.reduce(
            (sum, inv) => sum + inv.quantity, 0
        );
        groups[categoryValue].totalPrice += product.basePrice;
    });

    // Calculate averages and format
    return Object.values(groups).map(group => ({
        category: group.category,
        count: group.count,
        totalInventory: group.totalInventory,
        averagePrice: group.count > 0 ? group.totalPrice / group.count : 0
    }));
};

/**
 * Get product price statistics
 */
export const getPriceStatistics = async (): Promise<{
    minPrice: number;
    maxPrice: number;
    averagePrice: number;
    priceByType: Record<string, { min: number; max: number; avg: number }>;
    priceByGrade: Record<string, { min: number; max: number; avg: number }>;
}> => {
    const products = await prisma.product.findMany({
        select: {
            type: true,
            grade: true,
            basePrice: true
        }
    });

    if (products.length === 0) {
        return {
            minPrice: 0,
            maxPrice: 0,
            averagePrice: 0,
            priceByType: {},
            priceByGrade: {}
        };
    }

    const prices = products.map(p => p.basePrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Group by type
    const priceByType: Record<string, { prices: number[] }> = {};
    products.forEach(p => {
        if (!priceByType[p.type]) {
            priceByType[p.type] = { prices: [] };
        }
        priceByType[p.type].prices.push(p.basePrice);
    });

    // Group by grade
    const priceByGrade: Record<string, { prices: number[] }> = {};
    products.forEach(p => {
        if (!priceByGrade[p.grade]) {
            priceByGrade[p.grade] = { prices: [] };
        }
        priceByGrade[p.grade].prices.push(p.basePrice);
    });

    // Calculate stats
    const formatStats = (group: Record<string, { prices: number[] }>) => {
        const result: Record<string, { min: number; max: number; avg: number }> = {};
        Object.entries(group).forEach(([key, value]) => {
            if (value.prices.length > 0) {
                result[key] = {
                    min: Math.min(...value.prices),
                    max: Math.max(...value.prices),
                    avg: value.prices.reduce((a, b) => a + b, 0) / value.prices.length
                };
            }
        });
        return result;
    };

    return {
        minPrice,
        maxPrice,
        averagePrice,
        priceByType: formatStats(priceByType),
        priceByGrade: formatStats(priceByGrade)
    };
};