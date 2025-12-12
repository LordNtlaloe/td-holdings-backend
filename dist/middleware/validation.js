"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validationSchemas = void 0;
const joi_1 = __importDefault(require("joi"));
exports.validationSchemas = {
    register: joi_1.default.object({
        firstName: joi_1.default.string().required().min(2).max(50),
        lastName: joi_1.default.string().required().min(2).max(50),
        email: joi_1.default.string().required().email(),
        password: joi_1.default.string().required().min(8).max(100),
        phoneNumber: joi_1.default.string().optional().allow(''),
        role: joi_1.default.string().valid('ADMIN', 'MANAGER', 'CASHIER').default('CASHIER'),
        storeId: joi_1.default.string().optional(),
        position: joi_1.default.string().optional()
    }),
    login: joi_1.default.object({
        email: joi_1.default.string().required().email(),
        password: joi_1.default.string().required()
    }),
    verifyEmail: joi_1.default.object({
        email: joi_1.default.string().required().email(),
        code: joi_1.default.string().required().length(6)
    }),
    forgotPassword: joi_1.default.object({
        email: joi_1.default.string().required().email()
    }),
    resetPassword: joi_1.default.object({
        email: joi_1.default.string().required().email(),
        token: joi_1.default.string().required(),
        newPassword: joi_1.default.string().required().min(8).max(100)
    }),
    updateProfile: joi_1.default.object({
        firstName: joi_1.default.string().optional().min(2).max(50),
        lastName: joi_1.default.string().optional().min(2).max(50),
        phoneNumber: joi_1.default.string().optional().allow('')
    }),
    createEmployee: joi_1.default.object({
        firstName: joi_1.default.string().required().min(2).max(50),
        lastName: joi_1.default.string().required().min(2).max(50),
        email: joi_1.default.string().required().email(),
        phone: joi_1.default.string().optional().allow(''),
        position: joi_1.default.string().optional().default('Clerk'),
        storeId: joi_1.default.string().optional(),
        role: joi_1.default.string().valid('ADMIN', 'MANAGER', 'CASHIER').default('CASHIER'),
        sendInvitation: joi_1.default.boolean().default(true)
    }),
    updateEmployee: joi_1.default.object({
        firstName: joi_1.default.string().optional().min(2).max(50),
        lastName: joi_1.default.string().optional().min(2).max(50),
        phone: joi_1.default.string().optional().allow(''),
        position: joi_1.default.string().optional(),
        storeId: joi_1.default.string().optional(),
        role: joi_1.default.string().optional().valid('ADMIN', 'MANAGER', 'CASHIER')
    }),
    createProduct: joi_1.default.object({
        name: joi_1.default.string().required().min(2).max(200),
        price: joi_1.default.number().required().positive(),
        quantity: joi_1.default.number().required().integer().min(0),
        type: joi_1.default.string().required().valid('TIRE', 'BALE'),
        grade: joi_1.default.string().required().valid('A', 'B', 'C'),
        commodity: joi_1.default.string().optional(),
        storeId: joi_1.default.string().optional(),
        tireCategory: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().valid('NEW', 'SECOND_HAND').required(),
            otherwise: joi_1.default.forbidden()
        }),
        tireUsage: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK').required(),
            otherwise: joi_1.default.forbidden()
        }),
        tireSize: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        loadIndex: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        speedRating: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        warrantyPeriod: joi_1.default.string().when('type', {
            is: 'TIRE',
            then: joi_1.default.string().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        baleWeight: joi_1.default.number().when('type', {
            is: 'BALE',
            then: joi_1.default.number().positive().required(),
            otherwise: joi_1.default.forbidden()
        }),
        baleCategory: joi_1.default.string().when('type', {
            is: 'BALE',
            then: joi_1.default.string().required(),
            otherwise: joi_1.default.forbidden()
        }),
        originCountry: joi_1.default.string().when('type', {
            is: 'BALE',
            then: joi_1.default.string().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        importDate: joi_1.default.date().when('type', {
            is: 'BALE',
            then: joi_1.default.date().optional(),
            otherwise: joi_1.default.forbidden()
        }),
        baleCount: joi_1.default.number().when('type', {
            is: 'BALE',
            then: joi_1.default.number().integer().min(1).required(),
            otherwise: joi_1.default.forbidden()
        })
    }),
    updateProduct: joi_1.default.object({
        name: joi_1.default.string().optional().min(2).max(200),
        price: joi_1.default.number().optional().positive(),
        quantity: joi_1.default.number().optional().integer().min(0),
        type: joi_1.default.string().optional().valid('TIRE', 'BALE'),
        grade: joi_1.default.string().optional().valid('A', 'B', 'C'),
        commodity: joi_1.default.string().optional(),
        tireCategory: joi_1.default.string().optional().valid('NEW', 'SECOND_HAND'),
        tireUsage: joi_1.default.string().optional().valid('FOUR_BY_FOUR', 'REGULAR', 'TRUCK'),
        tireSize: joi_1.default.string().optional(),
        loadIndex: joi_1.default.string().optional(),
        speedRating: joi_1.default.string().optional(),
        warrantyPeriod: joi_1.default.string().optional(),
        baleWeight: joi_1.default.number().optional().positive(),
        baleCategory: joi_1.default.string().optional(),
        originCountry: joi_1.default.string().optional(),
        importDate: joi_1.default.date().optional(),
        baleCount: joi_1.default.number().optional().integer().min(1)
    }),
    updateQuantity: joi_1.default.object({
        quantity: joi_1.default.number().required().integer(),
        operation: joi_1.default.string().valid('SET', 'ADD', 'SUBTRACT').default('SET')
    }),
    createSale: joi_1.default.object({
        items: joi_1.default.array().items(joi_1.default.object({
            productId: joi_1.default.string().required(),
            quantity: joi_1.default.number().required().integer().min(1)
        })).required().min(1),
        customerInfo: joi_1.default.object({
            name: joi_1.default.string().optional(),
            phone: joi_1.default.string().optional(),
            email: joi_1.default.string().optional().email()
        }).optional()
    }),
    voidSale: joi_1.default.object({
        reason: joi_1.default.string().required().min(5).max(500)
    }),
    createStore: joi_1.default.object({
        name: joi_1.default.string().required().min(2).max(100),
        location: joi_1.default.string().required().min(2).max(200)
    }),
    updateStore: joi_1.default.object({
        name: joi_1.default.string().optional().min(2).max(100),
        location: joi_1.default.string().optional().min(2).max(200)
    }),
    transferProduct: joi_1.default.object({
        productId: joi_1.default.string().required(),
        fromStoreId: joi_1.default.string().required(),
        toStoreId: joi_1.default.string().required(),
        quantity: joi_1.default.number().required().integer().min(1)
    }),
    salesReport: joi_1.default.object({
        startDate: joi_1.default.date().optional(),
        endDate: joi_1.default.date().optional(),
        storeId: joi_1.default.string().optional(),
        employeeId: joi_1.default.string().optional(),
        format: joi_1.default.string().valid('json', 'csv', 'pdf').default('json'),
        groupBy: joi_1.default.string().valid('day', 'week', 'month', 'product', 'employee').default('day')
    }),
    inventoryReport: joi_1.default.object({
        storeId: joi_1.default.string().optional(),
        type: joi_1.default.string().valid('TIRE', 'BALE').optional(),
        category: joi_1.default.string().optional(),
        lowStockOnly: joi_1.default.boolean().default(false),
        format: joi_1.default.string().valid('json', 'csv', 'pdf').default('json')
    }),
    employeeReport: joi_1.default.object({
        storeId: joi_1.default.string().optional(),
        startDate: joi_1.default.date().optional(),
        endDate: joi_1.default.date().optional(),
        format: joi_1.default.string().valid('json', 'csv', 'pdf').default('json')
    })
};
//# sourceMappingURL=validation.js.map