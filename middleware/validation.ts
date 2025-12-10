// middleware/validation.ts
import Joi from 'joi';

export const validationSchemas = {
    // Auth schemas
    register: Joi.object({
        firstName: Joi.string().required().min(2).max(50),
        lastName: Joi.string().required().min(2).max(50),
        email: Joi.string().required().email(),
        password: Joi.string().required().min(8).max(100),
        phoneNumber: Joi.string().optional().allow(''),
        role: Joi.string().valid('ADMIN', 'MANAGER', 'CASHIER').default('CASHIER'),
        storeId: Joi.string().optional(),
        position: Joi.string().optional()
    }),

    login: Joi.object({
        email: Joi.string().required().email(),
        password: Joi.string().required()
    }),

    verifyEmail: Joi.object({
        email: Joi.string().required().email(),
        code: Joi.string().required().length(6)
    }),

    forgotPassword: Joi.object({
        email: Joi.string().required().email()
    }),

    resetPassword: Joi.object({
        email: Joi.string().required().email(),
        token: Joi.string().required(),
        newPassword: Joi.string().required().min(8).max(100)
    }),

    updateProfile: Joi.object({
        firstName: Joi.string().optional().min(2).max(50),
        lastName: Joi.string().optional().min(2).max(50),
        phoneNumber: Joi.string().optional().allow('')
    }),

    // Employee schemas
    createEmployee: Joi.object({
        firstName: Joi.string().required().min(2).max(50),
        lastName: Joi.string().required().min(2).max(50),
        email: Joi.string().required().email(),
        phone: Joi.string().optional().allow(''),
        position: Joi.string().optional().default('Clerk'),
        storeId: Joi.string().optional(),
        role: Joi.string().valid('ADMIN', 'MANAGER', 'CASHIER').default('CASHIER'),
        sendInvitation: Joi.boolean().default(true)
    }),

    updateEmployee: Joi.object({
        firstName: Joi.string().optional().min(2).max(50),
        lastName: Joi.string().optional().min(2).max(50),
        phone: Joi.string().optional().allow(''),
        position: Joi.string().optional(),
        storeId: Joi.string().optional(),
        role: Joi.string().optional().valid('ADMIN', 'MANAGER', 'CASHIER')
    }),

    // Product schemas
    createProduct: Joi.object({
        name: Joi.string().required().min(2).max(200),
        price: Joi.number().required().positive(),
        quantity: Joi.number().required().integer().min(0),
        type: Joi.string().required().valid('TIRE', 'BALE'),
        grade: Joi.string().required().valid('A', 'B', 'C'),
        commodity: Joi.string().optional(),
        storeId: Joi.string().optional(),

        // Tire fields
        tireCategory: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().valid('NEW', 'SECOND_HAND').required(),
            otherwise: Joi.forbidden()
        }),
        tireUsage: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK').required(),
            otherwise: Joi.forbidden()
        }),
        tireSize: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        loadIndex: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        speedRating: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        warrantyPeriod: Joi.string().when('type', {
            is: 'TIRE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),

        // Bale fields
        baleWeight: Joi.number().when('type', {
            is: 'BALE',
            then: Joi.number().positive().required(),
            otherwise: Joi.forbidden()
        }),
        baleCategory: Joi.string().when('type', {
            is: 'BALE',
            then: Joi.string().required(),
            otherwise: Joi.forbidden()
        }),
        originCountry: Joi.string().when('type', {
            is: 'BALE',
            then: Joi.string().optional(),
            otherwise: Joi.forbidden()
        }),
        importDate: Joi.date().when('type', {
            is: 'BALE',
            then: Joi.date().optional(),
            otherwise: Joi.forbidden()
        }),
        baleCount: Joi.number().when('type', {
            is: 'BALE',
            then: Joi.number().integer().min(1).required(),
            otherwise: Joi.forbidden()
        })
    }),

    updateProduct: Joi.object({
        name: Joi.string().optional().min(2).max(200),
        price: Joi.number().optional().positive(),
        quantity: Joi.number().optional().integer().min(0),
        type: Joi.string().optional().valid('TIRE', 'BALE'),
        grade: Joi.string().optional().valid('A', 'B', 'C'),
        commodity: Joi.string().optional(),

        // Tire fields
        tireCategory: Joi.string().optional().valid('NEW', 'SECOND_HAND'),
        tireUsage: Joi.string().optional().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK'),
        tireSize: Joi.string().optional(),
        loadIndex: Joi.string().optional(),
        speedRating: Joi.string().optional(),
        warrantyPeriod: Joi.string().optional(),

        // Bale fields
        baleWeight: Joi.number().optional().positive(),
        baleCategory: Joi.string().optional(),
        originCountry: Joi.string().optional(),
        importDate: Joi.date().optional(),
        baleCount: Joi.number().optional().integer().min(1)
    }),

    updateQuantity: Joi.object({
        quantity: Joi.number().required().integer(),
        operation: Joi.string().valid('SET', 'ADD', 'SUBTRACT').default('SET')
    }),

    // Sale schemas
    createSale: Joi.object({
        items: Joi.array().items(
            Joi.object({
                productId: Joi.string().required(),
                quantity: Joi.number().required().integer().min(1)
            })
        ).required().min(1),
        customerInfo: Joi.object({
            name: Joi.string().optional(),
            phone: Joi.string().optional(),
            email: Joi.string().optional().email()
        }).optional()
    }),

    voidSale: Joi.object({
        reason: Joi.string().required().min(5).max(500)
    }),

    // Store schemas
    createStore: Joi.object({
        name: Joi.string().required().min(2).max(100),
        location: Joi.string().required().min(2).max(200)
    }),

    updateStore: Joi.object({
        name: Joi.string().optional().min(2).max(100),
        location: Joi.string().optional().min(2).max(200)
    }),

    // Transfer schemas
    transferProduct: Joi.object({
        productId: Joi.string().required(),
        fromStoreId: Joi.string().required(),
        toStoreId: Joi.string().required(),
        quantity: Joi.number().required().integer().min(1)
    }),

    // Report schemas
    salesReport: Joi.object({
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        storeId: Joi.string().optional(),
        employeeId: Joi.string().optional(),
        format: Joi.string().valid('json', 'csv', 'pdf').default('json'),
        groupBy: Joi.string().valid('day', 'week', 'month', 'product', 'employee').default('day')
    }),

    inventoryReport: Joi.object({
        storeId: Joi.string().optional(),
        type: Joi.string().valid('TIRE', 'BALE').optional(),
        category: Joi.string().optional(),
        lowStockOnly: Joi.boolean().default(false),
        format: Joi.string().valid('json', 'csv', 'pdf').default('json')
    }),

    employeeReport: Joi.object({
        storeId: Joi.string().optional(),
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        format: Joi.string().valid('json', 'csv', 'pdf').default('json')
    })
};