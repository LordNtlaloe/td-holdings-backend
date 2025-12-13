import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';

export const validationSchemas = {
    // ============ AUTH SCHEMAS ============
    register: Joi.object({
        firstName: Joi.string().required().min(2).max(50),
        lastName: Joi.string().required().min(2).max(50),
        email: Joi.string().required().email(),
        password: Joi.string().required().min(8).max(100),
        phone: Joi.string().required().pattern(/^[0-9+\-\s()]{10,}$/),
        role: Joi.string().valid('ADMIN', 'MANAGER', 'CASHIER').default('CASHIER'),
        storeId: Joi.string().optional()
    }),

    login: Joi.object({
        email: Joi.string().required().email(),
        password: Joi.string().required()
    }),

    verifyAccount: Joi.object({
        email: Joi.string().required().email(),
        code: Joi.string().required().length(6)
    }),

    requestPasswordReset: Joi.object({
        email: Joi.string().required().email()
    }),

    resetPassword: Joi.object({
        email: Joi.string().required().email(),
        token: Joi.string().required(),
        newPassword: Joi.string().required().min(8).max(100)
    }),

    changePassword: Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: Joi.string().required().min(8).max(100)
    }),

    updateProfile: Joi.object({
        firstName: Joi.string().optional().min(2).max(50),
        lastName: Joi.string().optional().min(2).max(50),
        phone: Joi.string().optional().pattern(/^[0-9+\-\s()]{10,}$/)
    }),

    refreshToken: Joi.object({
        refreshToken: Joi.string().required()
    }),

    logout: Joi.object({
        refreshToken: Joi.string().optional()
    }),

    // ============ USER/EMPLOYEE SCHEMAS ============
    createEmployee: Joi.object({
        userId: Joi.string().required(),
        storeId: Joi.string().required(),
        position: Joi.string().required().min(2).max(100),
        role: Joi.string().valid('ADMIN', 'MANAGER', 'CASHIER').required()
    }),

    updateEmployee: Joi.object({
        position: Joi.string().optional().min(2).max(100),
        role: Joi.string().optional().valid('ADMIN', 'MANAGER', 'CASHIER'),
        storeId: Joi.string().optional()
    }),

    transferEmployee: Joi.object({
        newStoreId: Joi.string().required(),
        reason: Joi.string().optional().max(500)
    }),

    // ============ STORE SCHEMAS ============
    createStore: Joi.object({
        name: Joi.string().required().min(2).max(100),
        location: Joi.string().required().min(2).max(200),
        phone: Joi.string().required().pattern(/^[0-9+\-\s()]{10,}$/),
        email: Joi.string().required().email(),
        isMainStore: Joi.boolean().default(false)
    }),

    updateStore: Joi.object({
        name: Joi.string().optional().min(2).max(100),
        location: Joi.string().optional().min(2).max(200),
        phone: Joi.string().optional().pattern(/^[0-9+\-\s()]{10,}$/),
        email: Joi.string().optional().email(),
        isMainStore: Joi.boolean().optional()
    }),

    // ============ PRODUCT CATALOG SCHEMAS ============
    createProduct: Joi.object({
        name: Joi.string().required().min(2).max(200),
        basePrice: Joi.number().required().positive(),
        type: Joi.string().required().valid('TIRE', 'BALE'),
        grade: Joi.string().required().valid('A', 'B', 'C'),
        commodity: Joi.string().optional().allow(''),

        // Tire-specific fields (conditional)
        tireCategory: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().valid('NEW', 'SECOND_HAND').optional(),
            otherwise: Joi.forbidden()
        }),
        tireUsage: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK').optional(),
            otherwise: Joi.forbidden()
        }),
        tireSize: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        loadIndex: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        speedRating: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        warrantyPeriod: Joi.when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),

        // Bale-specific fields (conditional)
        baleWeight: Joi.when('type', {
            is: 'BALE',
            then: Joi.number().positive().optional(),
            otherwise: Joi.forbidden()
        }),
        baleCategory: Joi.when('type', {
            is: 'BALE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        originCountry: Joi.when('type', {
            is: 'BALE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        importDate: Joi.when('type', {
            is: 'BALE',
            then: Joi.date().optional(),
            otherwise: Joi.forbidden()
        }),

        // Store assignments
        storeAssignments: Joi.array().items(
            Joi.object({
                storeId: Joi.string().required(),
                initialQuantity: Joi.number().integer().min(0).optional(),
                storePrice: Joi.number().positive().optional()
            })
        ).optional()
    }),

    updateProduct: Joi.object({
        name: Joi.string().optional().min(2).max(200),
        basePrice: Joi.number().optional().positive(),
        grade: Joi.string().optional().valid('A', 'B', 'C'),
        commodity: Joi.string().optional().allow(''),

        // Tire-specific fields
        tireCategory: Joi.string().optional().valid('NEW', 'SECOND_HAND'),
        tireUsage: Joi.string().optional().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK'),
        tireSize: Joi.string().optional(),
        loadIndex: Joi.string().optional(),
        speedRating: Joi.string().optional(),
        warrantyPeriod: Joi.string().optional(),

        // Bale-specific fields
        baleWeight: Joi.number().optional().positive(),
        baleCategory: Joi.string().optional(),
        originCountry: Joi.string().optional(),
        importDate: Joi.date().optional()
    }),

    assignProductToStores: Joi.object({
        storeIds: Joi.array().items(Joi.string()).required().min(1),
        initialQuantities: Joi.object().pattern(
            Joi.string(),
            Joi.number().integer().min(0)
        ).optional()
    }),

    removeProductFromStore: Joi.object({
        storeId: Joi.string().required()
    }),

    // ============ INVENTORY SCHEMAS ============
    allocateInventory: Joi.object({
        productId: Joi.string().required(),
        storeId: Joi.string().required(),
        quantity: Joi.number().required().integer().min(0),
        storePrice: Joi.number().optional().positive()
    }),

    adjustInventory: Joi.object({
        adjustment: Joi.number().required().integer(),
        changeType: Joi.string().required().valid(
            'PURCHASE',
            'SALE',
            'TRANSFER_OUT',
            'TRANSFER_IN',
            'ADJUSTMENT',
            'RETURN',
            'DAMAGE'
        ),
        notes: Joi.string().optional().max(500),
        referenceId: Joi.string().optional()
    }),

    reserveInventory: Joi.object({
        productId: Joi.string().required(),
        storeId: Joi.string().required(),
        quantity: Joi.number().required().integer().min(1),
        reservationId: Joi.string().required()
    }),

    setReorderLevels: Joi.object({
        reorderLevel: Joi.number().required().integer().min(0),
        optimalLevel: Joi.number().required().integer().min(Joi.ref('reorderLevel'))
    }),

    receiveShipment: Joi.object({
        updates: Joi.array().items(
            Joi.object({
                productId: Joi.string().required(),
                storeId: Joi.string().required(),
                quantity: Joi.number().required().integer().min(1),
                storePrice: Joi.number().optional().positive()
            })
        ).required().min(1),
        shipmentId: Joi.string().required()
    }),

    // ============ TRANSFER SCHEMAS ============
    initiateTransfer: Joi.object({
        productId: Joi.string().required(),
        fromStoreId: Joi.string().required(),
        toStoreId: Joi.string().required().disallow(Joi.ref('fromStoreId')),
        quantity: Joi.number().required().integer().min(1),
        reason: Joi.string().optional().max(500),
        notes: Joi.string().optional().max(1000)
    }),

    completeTransfer: Joi.object({
        transferId: Joi.string().required()
    }),

    cancelTransfer: Joi.object({
        reason: Joi.string().optional().max(500)
    }),

    rejectTransfer: Joi.object({
        reason: Joi.string().required().min(5).max(500)
    }),

    // ============ SALES SCHEMAS ============
    createSale: Joi.object({
        employeeId: Joi.string().required(),
        storeId: Joi.string().required(),
        items: Joi.array().items(
            Joi.object({
                productId: Joi.string().required(),
                quantity: Joi.number().required().integer().min(1),
                price: Joi.number().required().positive()
            })
        ).required().min(1),
        paymentMethod: Joi.string().required().valid('MOBILE', 'CASH', 'CARD'),
        customerInfo: Joi.object({
            name: Joi.string().optional().max(100),
            email: Joi.string().optional().email(),
            phone: Joi.string().optional().pattern(/^[0-9+\-\s()]{10,}$/)
        }).optional()
    }),

    processReturn: Joi.object({
        returnItems: Joi.array().items(
            Joi.object({
                saleItemId: Joi.string().required(),
                quantity: Joi.number().required().integer().min(1),
                refundAmount: Joi.number().optional().positive()
            })
        ).required().min(1),
        reason: Joi.string().optional().max(500)
    }),

    voidSale: Joi.object({
        reason: Joi.string().required().min(5).max(500)
    }),

    // ============ QUERY/FILTER SCHEMAS ============
    pagination: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(50),
        sortBy: Joi.string().optional(),
        sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    }),

    dateRange: Joi.object({
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional()
    }),

    productSearch: Joi.object({
        name: Joi.string().optional(),
        type: Joi.string().optional().valid('TIRE', 'BALE'),
        grade: Joi.string().optional().valid('A', 'B', 'C'),
        commodity: Joi.string().optional(),
        tireCategory: Joi.string().optional().valid('NEW', 'SECOND_HAND'),
        tireUsage: Joi.string().optional().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK'),
        minPrice: Joi.number().optional().positive(),
        maxPrice: Joi.number().optional().positive(),
        inStock: Joi.boolean().optional(),
        storeId: Joi.string().optional()
    }),

    salesFilter: Joi.object({
        storeId: Joi.string().optional(),
        employeeId: Joi.string().optional(),
        paymentMethod: Joi.string().optional().valid('MOBILE', 'CASH', 'CARD'),
        minTotal: Joi.number().optional().positive(),
        maxTotal: Joi.number().optional().positive(),
        voided: Joi.boolean().optional()
    }),

    transferFilter: Joi.object({
        status: Joi.string().optional().valid('PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'),
        productId: Joi.string().optional(),
        fromStoreId: Joi.string().optional(),
        toStoreId: Joi.string().optional(),
        initiatedBy: Joi.string().optional()
    }),

    employeeFilter: Joi.object({
        storeId: Joi.string().optional(),
        role: Joi.string().optional().valid('ADMIN', 'MANAGER', 'CASHIER'),
        position: Joi.string().optional(),
        activeOnly: Joi.boolean().optional(),
        search: Joi.string().optional()
    }),

    // ============ REPORT SCHEMAS ============
    salesReport: Joi.object({
        storeId: Joi.string().optional(),
        startDate: Joi.date().required(),
        endDate: Joi.date().required(),
        groupBy: Joi.string().valid('hour', 'day', 'week', 'month', 'product', 'employee').default('day'),
        format: Joi.string().valid('json', 'csv').default('json')
    }),

    inventoryReport: Joi.object({
        storeId: Joi.string().optional(),
        productId: Joi.string().optional(),
        changeType: Joi.array().items(
            Joi.string().valid(
                'PURCHASE',
                'SALE',
                'TRANSFER_OUT',
                'TRANSFER_IN',
                'ADJUSTMENT',
                'RETURN',
                'DAMAGE'
            )
        ).optional(),
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        format: Joi.string().valid('json', 'csv').default('json')
    }),

    transferReport: Joi.object({
        storeId: Joi.string().optional(),
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        status: Joi.string().optional().valid('PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED')
    }),

    employeePerformanceReport: Joi.object({
        employeeId: Joi.string().optional(),
        storeId: Joi.string().optional(),
        period: Joi.string().valid('day', 'week', 'month', 'year').default('month'),
        compareWithStore: Joi.boolean().default(false)
    }),

    storePerformanceReport: Joi.object({
        storeId: Joi.string().required(),
        period: Joi.string().valid('day', 'week', 'month', 'year').default('month')
    }),

    // ============ AUDIT SCHEMAS ============
    activityLogFilter: Joi.object({
        userId: Joi.string().optional(),
        action: Joi.string().optional(),
        entityType: Joi.string().optional(),
        entityId: Joi.string().optional(),
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        search: Joi.string().optional()
    }),

    // ============ SYSTEM SCHEMAS ============
    cleanupSettings: Joi.object({
        retentionDays: Joi.number().integer().min(1).max(3650).default(365)
    })
};

/**
 * Validation middleware factory
 */
export const validate = (schemaName: keyof typeof validationSchemas, property: 'body' | 'query' | 'params' = 'body') => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const schema = validationSchemas[schemaName];

        if (!schema) {
            res.status(500).json({ error: `Validation schema '${schemaName}' not found` });
            return;
        }

        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message.replace(/"/g, '')
            }));

            res.status(400).json({
                error: 'VALIDATION_ERROR',
                details: errors
            });
            return;
        }

        // Replace request data with validated data
        req[property] = value;
        next();
    };
};

/**
 * Combined validation for multiple parts of the request
 */
export const validateMulti = (validations: Array<{
    schemaName: keyof typeof validationSchemas;
    property: 'body' | 'query' | 'params';
}>) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        for (const validation of validations) {
            const schema = validationSchemas[validation.schemaName];

            if (!schema) {
                res.status(500).json({ error: `Validation schema '${validation.schemaName}' not found` });
                return;
            }

            const { error, value } = schema.validate(req[validation.property], {
                abortEarly: false,
                stripUnknown: true
            });

            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message.replace(/"/g, '')
                }));

                res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    details: errors,
                    source: validation.property
                });
                return;
            }

            // Replace request data with validated data
            req[validation.property] = value;
        }

        next();
    };
};

/**
 * Validate with custom schema (for one-off validations)
 */
export const validateWithSchema = (schema: Joi.Schema, property: 'body' | 'query' | 'params' = 'body') => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message.replace(/"/g, '')
            }));

            res.status(400).json({
                error: 'VALIDATION_ERROR',
                details: errors
            });
            return;
        }

        req[property] = value;
        next();
    };
};