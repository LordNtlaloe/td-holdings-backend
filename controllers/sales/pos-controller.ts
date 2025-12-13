import { prisma } from "../../lib/prisma";
import { PaymentMethodType, InventoryChangeType } from "@prisma/client";

/**
 * SALES POS CONTROLLER: Point of Sale operations
 * 
 * Aggregate Root: Sale
 * Coordinates: SaleItem, Inventory, InventoryHistory, Employee, Store
 * 
 * Key Invariants:
 * 1. Employee must be assigned to the store
 * 2. Sufficient inventory for all items
 * 3. Total must match sum of items
 * 4. Sale cannot be modified after creation
 */

// ============ SALE CREATION ============

/**
 * Create a new sale
 * Validates inventory, creates sale items, updates inventory
 * 
 * @param employeeId Employee making the sale
 * @param storeId Store where sale occurs
 * @param items Sale items with product, quantity, and price
 * @param paymentMethod Payment method used
 * @param customerInfo Optional customer information
 * @param createdBy User ID creating the sale (may differ from employee for overrides)
 */
export const createSale = async (
    employeeId: string,
    storeId: string,
    items: Array<{
        productId: string;
        quantity: number;
        price: number; // Price at time of sale
    }>,
    paymentMethod: PaymentMethodType,
    customerInfo?: {
        name?: string;
        email?: string;
        phone?: string;
    },
    createdBy?: string
): Promise<{
    sale: any;
    saleItems: any[];
    inventoryUpdates: any[];
    inventoryHistories: any[];
}> => {
    // Validate inputs
    if (items.length === 0) {
        throw new Error("NO_ITEMS: Sale must have at least one item");
    }

    // Validate quantities and prices
    for (const item of items) {
        if (item.quantity <= 0) {
            throw new Error(`INVALID_QUANTITY: Quantity must be positive for product ${item.productId}`);
        }
        if (item.price < 0) {
            throw new Error(`INVALID_PRICE: Price cannot be negative for product ${item.productId}`);
        }
    }

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08; // 8% tax example, adjust as needed
    const total = subtotal + tax;

    // Transaction: Validate + create sale + update inventory atomically
    return await prisma.$transaction(async (tx) => {
        // Verify employee exists and is assigned to store
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

        if (employee.storeId !== storeId) {
            throw new Error(
                `EMPLOYEE_NOT_ASSIGNED: Employee ${employeeId} is assigned to store ${employee.storeId}, ` +
                `not ${storeId}`
            );
        }

        // Verify store exists
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) {
            throw new Error("STORE_NOT_FOUND: Store does not exist");
        }

        // Validate inventory and lock inventory rows
        const inventoryUpdates = [];
        const inventoryHistories = [];
        const saleItemsData = [];

        for (const item of items) {
            // Get product details
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            if (!product) {
                throw new Error(`PRODUCT_NOT_FOUND: Product ${item.productId} does not exist`);
            }

            // Check if product is available in this store
            const inventory = await tx.inventory.findUnique({
                where: {
                    productId_storeId: {
                        productId: item.productId,
                        storeId
                    }
                }
            });

            if (!inventory) {
                throw new Error(
                    `PRODUCT_NOT_AVAILABLE: Product ${product.name} is not available in store ${store.name}`
                );
            }

            // Check sufficient inventory
            if (inventory.quantity < item.quantity) {
                throw new Error(
                    `INSUFFICIENT_INVENTORY: Product ${product.name} has ${inventory.quantity} units, ` +
                    `but ${item.quantity} requested for sale`
                );
            }

            // Update inventory (decrement)
            const updatedInventory = await tx.inventory.update({
                where: {
                    productId_storeId: {
                        productId: item.productId,
                        storeId
                    }
                },
                data: {
                    quantity: { decrement: item.quantity },
                    updatedAt: new Date()
                }
            });

            inventoryUpdates.push(updatedInventory);

            // Create inventory history
            const history = await tx.inventoryHistory.create({
                data: {
                    inventoryId: inventory.id,
                    changeType: InventoryChangeType.SALE,
                    quantityChange: -item.quantity,
                    previousQuantity: inventory.quantity,
                    newQuantity: updatedInventory.quantity,
                    referenceType: "SALE",
                    notes: `Sold ${item.quantity} units`,
                    createdBy: createdBy || employee.userId,
                    createdAt: new Date()
                }
            });

            inventoryHistories.push(history);

            // Prepare sale item data
            saleItemsData.push({
                productId: item.productId,
                quantity: item.quantity,
                price: item.price
            });
        }

        // Create sale
        const sale = await tx.sale.create({
            data: {
                employeeId,
                storeId,
                userId: createdBy || employee.userId,
                total,
                subtotal,
                tax,
                paymentMethod,
                customerName: customerInfo?.name,
                customerEmail: customerInfo?.email,
                customerPhone: customerInfo?.phone,
                createdAt: new Date()
            }
        });

        // Create sale items
        const createdSaleItems = [];
        for (const itemData of saleItemsData) {
            const saleItem = await tx.saleItem.create({
                data: {
                    saleId: sale.id,
                    productId: itemData.productId,
                    quantity: itemData.quantity,
                    price: itemData.price
                },
                include: {
                    product: {
                        select: { id: true, name: true, type: true }
                    }
                }
            });
            createdSaleItems.push(saleItem);
        }

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: createdBy || employee.userId,
                action: "SALE_CREATED",
                entityType: "SALE",
                entityId: sale.id,
                details: {
                    storeId,
                    employeeId,
                    itemCount: items.length,
                    total,
                    paymentMethod
                },
                createdAt: new Date()
            }
        });

        return {
            sale,
            saleItems: createdSaleItems,
            inventoryUpdates,
            inventoryHistories
        };
    });
};

/**
 * Get sale details with all related data
 * 
 * @param saleId Sale ID
 */
export const getSaleDetails = async (
    saleId: string
): Promise<any> => {
    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            employee: {
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    }
                }
            },
            store: {
                select: {
                    id: true,
                    name: true,
                    location: true
                }
            },
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true
                }
            },
            saleItems: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            type: true,
                            grade: true
                        }
                    }
                }
            },
            voidedSale: true
        }
    });

    if (!sale) {
        throw new Error("SALE_NOT_FOUND: Sale does not exist");
    }

    return sale;
};

/**
 * Get sales with filters
 * 
 * @param filters Sale filters
 * @param page Page number
 * @param limit Items per page
 */
export const getSales = async (
    filters: {
        storeId?: string;
        employeeId?: string;
        dateFrom?: Date;
        dateTo?: Date;
        paymentMethod?: PaymentMethodType;
        minTotal?: number;
        maxTotal?: number;
        voided?: boolean; // Include voided sales
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    sales: any[];
    total: number;
    page: number;
    totalPages: number;
    summary: {
        totalSales: number;
        totalRevenue: number;
        averageSale: number;
        itemCount: number;
    };
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.storeId) {
        whereCondition.storeId = filters.storeId;
    }
    if (filters.employeeId) {
        whereCondition.employeeId = filters.employeeId;
    }
    if (filters.dateFrom || filters.dateTo) {
        whereCondition.createdAt = {};
        if (filters.dateFrom) whereCondition.createdAt.gte = filters.dateFrom;
        if (filters.dateTo) whereCondition.createdAt.lte = filters.dateTo;
    }
    if (filters.paymentMethod) {
        whereCondition.paymentMethod = filters.paymentMethod;
    }
    if (filters.minTotal !== undefined || filters.maxTotal !== undefined) {
        whereCondition.total = {};
        if (filters.minTotal !== undefined) whereCondition.total.gte = filters.minTotal;
        if (filters.maxTotal !== undefined) whereCondition.total.lte = filters.maxTotal;
    }
    if (filters.voided === false) {
        whereCondition.voidedSale = { is: null };
    }

    const [sales, total, allFilteredSales] = await Promise.all([
        prisma.sale.findMany({
            where: whereCondition,
            include: {
                employee: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                store: {
                    select: { id: true, name: true }
                },
                saleItems: {
                    select: { id: true }
                },
                voidedSale: {
                    select: { id: true, reason: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.sale.count({ where: whereCondition }),
        prisma.sale.findMany({
            where: whereCondition,
            select: {
                id: true,
                total: true,
                saleItems: {
                    select: { quantity: true }
                }
            }
        })
    ]);

    // Calculate summary statistics
    const summary = {
        totalSales: allFilteredSales.length,
        totalRevenue: allFilteredSales.reduce((sum, sale) => sum + sale.total, 0),
        averageSale: allFilteredSales.length > 0
            ? allFilteredSales.reduce((sum, sale) => sum + sale.total, 0) / allFilteredSales.length
            : 0,
        itemCount: allFilteredSales.reduce((sum, sale) =>
            sum + sale.saleItems.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)
    };

    const totalPages = Math.ceil(total / limit);

    return {
        sales,
        total,
        page,
        totalPages,
        summary
    };
};

/**
 * Get sales statistics by time period
 * 
 * @param period Time period (day, week, month, year)
 * @param storeId Optional store filter
 */
export const getSalesStatistics = async (
    period: 'day' | 'week' | 'month' | 'year',
    storeId?: string
): Promise<{
    period: string;
    totalSales: number;
    totalRevenue: number;
    averageSale: number;
    salesByHour?: Array<{ hour: number; sales: number; revenue: number }>;
    salesByDay?: Array<{ day: string; sales: number; revenue: number }>;
    salesByProduct?: Array<{ productId: string; productName: string; quantity: number; revenue: number }>;
    salesByEmployee?: Array<{ employeeId: string; employeeName: string; sales: number; revenue: number }>;
}> => {
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

    // Build where condition
    const whereCondition: any = {
        createdAt: {
            gte: startDate,
            lte: now
        }
    };

    if (storeId) {
        whereCondition.storeId = storeId;
    }

    // Get sales with related data
    const sales = await prisma.sale.findMany({
        where: whereCondition,
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
            },
            employee: {
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    });

    // Calculate basic statistics
    const totalSales = sales.length;
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const averageSale = totalSales > 0 ? totalRevenue / totalSales : 0;

    const result: any = {
        period,
        totalSales,
        totalRevenue,
        averageSale
    };

    // Group by hour for daily stats
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

        result.salesByHour = Object.entries(salesByHour).map(([hour, data]: [string, any]) => ({
            hour: parseInt(hour),
            sales: data.sales,
            revenue: data.revenue
        }));
    }

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

    result.salesByProduct = Array.from(productMap.entries())
        .map(([id, data]) => ({
            productId: id,
            productName: data.name,
            quantity: data.quantity,
            revenue: data.revenue
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

    // Group by employee
    const employeeMap = new Map<string, { name: string; sales: number; revenue: number }>();
    sales.forEach(sale => {
        const employeeKey = sale.employeeId;
        if (!employeeMap.has(employeeKey)) {
            employeeMap.set(employeeKey, {
                name: `${sale.employee.user.firstName} ${sale.employee.user.lastName}`,
                sales: 0,
                revenue: 0
            });
        }
        const employeeData = employeeMap.get(employeeKey)!;
        employeeData.sales++;
        employeeData.revenue += sale.total;
    });

    result.salesByEmployee = Array.from(employeeMap.entries())
        .map(([id, data]) => ({
            employeeId: id,
            employeeName: data.name,
            sales: data.sales,
            revenue: data.revenue
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    return result;
};

/**
 * Process return/refund for sale items
 * Creates negative sale items and restocks inventory
 * 
 * @param saleId Original sale ID
 * @param returnItems Items to return
 * @param processedBy User ID processing return
 * @param reason Reason for return
 */
export const processReturn = async (
    saleId: string,
    returnItems: Array<{
        saleItemId: string;
        quantity: number;
        refundAmount?: number; // Optional partial refund
    }>,
    processedBy: string,
    reason?: string
): Promise<{
    returnSale: any;
    returnItems: any[];
    inventoryUpdates: any[];
    inventoryHistories: any[];
}> => {
    if (returnItems.length === 0) {
        throw new Error("NO_RETURN_ITEMS: At least one item must be returned");
    }

    // Transaction: Validate + create return + restock inventory atomically
    return await prisma.$transaction(async (tx) => {
        // Get original sale
        const originalSale = await tx.sale.findUnique({
            where: { id: saleId },
            include: {
                saleItems: {
                    include: {
                        product: true
                    }
                },
                store: true,
                employee: true,
                voidedSale: true
            }
        });

        if (!originalSale) {
            throw new Error("SALE_NOT_FOUND: Original sale does not exist");
        }

        // Check if sale is already voided
        if (originalSale.voidedSale) {
            throw new Error("SALE_ALREADY_VOIDED: This sale has already been voided");
        }

        const inventoryUpdates = [];
        const inventoryHistories = [];
        const returnSaleItemsData = [];
        let returnTotal = 0;

        // Validate each return item
        for (const returnItem of returnItems) {
            const originalItem = originalSale.saleItems.find(
                item => item.id === returnItem.saleItemId
            );

            if (!originalItem) {
                throw new Error(`SALE_ITEM_NOT_FOUND: Sale item ${returnItem.saleItemId} not found in sale`);
            }

            // Validate return quantity
            if (returnItem.quantity <= 0) {
                throw new Error(`INVALID_QUANTITY: Return quantity must be positive for item ${originalItem.productId}`);
            }

            if (returnItem.quantity > originalItem.quantity) {
                throw new Error(
                    `EXCESS_RETURN_QUANTITY: Cannot return ${returnItem.quantity} units, ` +
                    `only ${originalItem.quantity} were purchased`
                );
            }

            // Calculate refund amount (default to proportional refund)
            const refundAmount = returnItem.refundAmount !== undefined
                ? returnItem.refundAmount
                : (originalItem.price * returnItem.quantity);

            if (refundAmount < 0) {
                throw new Error(`INVALID_REFUND_AMOUNT: Refund amount cannot be negative for item ${originalItem.productId}`);
            }

            returnTotal += refundAmount;

            // Restock inventory
            const inventory = await tx.inventory.findUnique({
                where: {
                    productId_storeId: {
                        productId: originalItem.productId,
                        storeId: originalSale.storeId
                    }
                }
            });

            if (!inventory) {
                // Create inventory record if it doesn't exist
                const newInventory = await tx.inventory.create({
                    data: {
                        productId: originalItem.productId,
                        storeId: originalSale.storeId,
                        quantity: returnItem.quantity,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                });
                inventoryUpdates.push(newInventory);
            } else {
                // Update existing inventory
                const updatedInventory = await tx.inventory.update({
                    where: {
                        productId_storeId: {
                            productId: originalItem.productId,
                            storeId: originalSale.storeId
                        }
                    },
                    data: {
                        quantity: { increment: returnItem.quantity },
                        updatedAt: new Date()
                    }
                });
                inventoryUpdates.push(updatedInventory);
            }

            // Create inventory history
            const history = await tx.inventoryHistory.create({
                data: {
                    inventoryId: (await tx.inventory.findUnique({
                        where: {
                            productId_storeId: {
                                productId: originalItem.productId,
                                storeId: originalSale.storeId
                            }
                        }
                    }))!.id,
                    changeType: InventoryChangeType.RETURN,
                    quantityChange: returnItem.quantity,
                    previousQuantity: inventory?.quantity || 0,
                    newQuantity: (inventory?.quantity || 0) + returnItem.quantity,
                    referenceId: saleId,
                    referenceType: "RETURN",
                    notes: `Customer return: ${reason || 'No reason provided'}`,
                    createdBy: processedBy,
                    createdAt: new Date()
                }
            });

            inventoryHistories.push(history);

            // Prepare return sale item data
            returnSaleItemsData.push({
                productId: originalItem.productId,
                quantity: returnItem.quantity,
                price: -refundAmount / returnItem.quantity, // Negative price for return
                originalSaleItemId: originalItem.id
            });
        }

        // Create return sale (negative sale)
        const returnSale = await tx.sale.create({
            data: {
                employeeId: originalSale.employeeId,
                storeId: originalSale.storeId,
                userId: processedBy,
                total: -returnTotal,
                subtotal: -returnTotal,
                tax: 0, // Returns typically don't include tax refund
                paymentMethod: originalSale.paymentMethod,
                customerName: originalSale.customerName,
                customerEmail: originalSale.customerEmail,
                customerPhone: originalSale.customerPhone,
                createdAt: new Date()
            }
        });

        // Create return sale items
        const createdReturnItems = [];
        for (const itemData of returnSaleItemsData) {
            const saleItem = await tx.saleItem.create({
                data: {
                    saleId: returnSale.id,
                    productId: itemData.productId,
                    quantity: itemData.quantity,
                    price: itemData.price
                },
                include: {
                    product: {
                        select: { id: true, name: true }
                    }
                }
            });
            createdReturnItems.push(saleItem);
        }

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: processedBy,
                action: "RETURN_PROCESSED",
                entityType: "SALE",
                entityId: saleId,
                details: {
                    returnSaleId: returnSale.id,
                    reason,
                    itemCount: returnItems.length,
                    totalRefund: returnTotal
                },
                createdAt: new Date()
            }
        });

        return {
            returnSale,
            returnItems: createdReturnItems,
            inventoryUpdates,
            inventoryHistories
        };
    });
};