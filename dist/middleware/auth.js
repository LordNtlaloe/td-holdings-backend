"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logActivity = exports.validateRequest = exports.rateLimit = exports.requireSaleAccess = exports.requireProductAccess = exports.requireEmployeeAccess = exports.requireStoreAccess = exports.requireRole = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../lib/prisma");
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'NO_TOKEN'
            });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        if (!decoded.userId || !decoded.email || !decoded.role) {
            return res.status(401).json({
                error: 'Invalid token payload',
                code: 'INVALID_TOKEN'
            });
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                employee: {
                    include: {
                        store: true
                    }
                }
            }
        });
        if (!user) {
            return res.status(401).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }
        if (user.isActive === false) {
            return res.status(403).json({
                error: 'Account is deactivated',
                code: 'ACCOUNT_DEACTIVATED'
            });
        }
        if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
            return res.status(403).json({
                error: 'Email not verified',
                code: 'EMAIL_NOT_VERIFIED'
            });
        }
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            storeId: user.employee?.storeId,
            employeeId: user.employee?.id
        };
        next();
    }
    catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }
        return res.status(401).json({
            error: 'Authentication failed',
            code: 'AUTH_FAILED'
        });
    }
};
exports.authenticate = authenticate;
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'NO_AUTH'
            });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: `Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`,
                code: 'INSUFFICIENT_PERMISSIONS',
                requiredRoles: allowedRoles,
                userRole: req.user.role
            });
        }
        next();
    };
};
exports.requireRole = requireRole;
const requireStoreAccess = (options) => {
    return async (req, res, next) => {
        try {
            const { storeId } = req.params;
            const user = req.user;
            const allowAdmin = options?.allowAdmin ?? true;
            if (allowAdmin && user.role === 'ADMIN') {
                return next();
            }
            const targetStoreId = storeId || req.body.storeId || req.query.storeId;
            if (!targetStoreId) {
                return res.status(400).json({
                    error: 'Store ID is required',
                    code: 'STORE_ID_REQUIRED'
                });
            }
            const employee = await prisma_1.prisma.employee.findFirst({
                where: {
                    userId: user.id,
                    storeId: targetStoreId
                }
            });
            if (!employee) {
                return res.status(403).json({
                    error: 'Access denied to this store',
                    code: 'STORE_ACCESS_DENIED',
                    storeId: targetStoreId
                });
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
exports.requireStoreAccess = requireStoreAccess;
const requireEmployeeAccess = () => {
    return async (req, res, next) => {
        try {
            const { employeeId } = req.params;
            const user = req.user;
            if (!employeeId) {
                return res.status(400).json({
                    error: 'Employee ID is required',
                    code: 'EMPLOYEE_ID_REQUIRED'
                });
            }
            if (user.role === 'ADMIN') {
                return next();
            }
            const targetEmployee = await prisma_1.prisma.employee.findUnique({
                where: { id: employeeId },
                include: { store: true }
            });
            if (!targetEmployee) {
                return res.status(404).json({
                    error: 'Employee not found',
                    code: 'EMPLOYEE_NOT_FOUND'
                });
            }
            if (user.employeeId === employeeId) {
                return next();
            }
            if (user.role === 'MANAGER' && user.storeId === targetEmployee.storeId) {
                return next();
            }
            return res.status(403).json({
                error: 'Access denied to this employee data',
                code: 'EMPLOYEE_ACCESS_DENIED'
            });
        }
        catch (error) {
            next(error);
        }
    };
};
exports.requireEmployeeAccess = requireEmployeeAccess;
const requireProductAccess = () => {
    return async (req, res, next) => {
        try {
            const { productId } = req.params;
            const user = req.user;
            if (!productId) {
                return res.status(400).json({
                    error: 'Product ID is required',
                    code: 'PRODUCT_ID_REQUIRED'
                });
            }
            const product = await prisma_1.prisma.product.findUnique({
                where: { id: productId }
            });
            if (!product) {
                return res.status(404).json({
                    error: 'Product not found',
                    code: 'PRODUCT_NOT_FOUND'
                });
            }
            if (user.role === 'ADMIN') {
                return next();
            }
            if (user.storeId === product.storeId) {
                return next();
            }
            const storeProduct = await prisma_1.prisma.storeProduct.findUnique({
                where: {
                    productId_storeId: {
                        productId,
                        storeId: user.storeId
                    }
                }
            });
            if (storeProduct) {
                return next();
            }
            return res.status(403).json({
                error: 'Access denied to this product',
                code: 'PRODUCT_ACCESS_DENIED'
            });
        }
        catch (error) {
            next(error);
        }
    };
};
exports.requireProductAccess = requireProductAccess;
const requireSaleAccess = () => {
    return async (req, res, next) => {
        try {
            const { saleId } = req.params;
            const user = req.user;
            if (!saleId) {
                return res.status(400).json({
                    error: 'Sale ID is required',
                    code: 'SALE_ID_REQUIRED'
                });
            }
            const sale = await prisma_1.prisma.sale.findUnique({
                where: { id: saleId },
                include: {
                    employee: true
                }
            });
            if (!sale) {
                return res.status(404).json({
                    error: 'Sale not found',
                    code: 'SALE_NOT_FOUND'
                });
            }
            if (user.role === 'ADMIN') {
                return next();
            }
            if (user.employeeId === sale.employeeId) {
                return next();
            }
            if (user.role === 'MANAGER' && user.storeId === sale.storeId) {
                return next();
            }
            return res.status(403).json({
                error: 'Access denied to this sale',
                code: 'SALE_ACCESS_DENIED'
            });
        }
        catch (error) {
            next(error);
        }
    };
};
exports.requireSaleAccess = requireSaleAccess;
const rateLimit = (options) => {
    const requests = new Map();
    return (req, res, next) => {
        const key = options.keyGenerator
            ? options.keyGenerator(req)
            : req.ip || 'unknown';
        const now = Date.now();
        const windowStart = now - options.windowMs;
        const recentRequests = (requests.get(key) || []).filter((timestamp) => timestamp > windowStart);
        if (recentRequests.length >= options.max) {
            return res.status(429).json({
                error: options.message || 'Too many requests, please try again later.',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: Math.ceil((recentRequests[0] + options.windowMs - now) / 1000)
            });
        }
        recentRequests.push(now);
        requests.set(key, recentRequests);
        res.setHeader('X-RateLimit-Limit', options.max);
        res.setHeader('X-RateLimit-Remaining', options.max - recentRequests.length);
        res.setHeader('X-RateLimit-Reset', new Date(now + options.windowMs).toISOString());
        next();
    };
};
exports.rateLimit = rateLimit;
const validateRequest = (schema) => {
    return (req, res, next) => {
        try {
            const { error, value } = schema.validate(req.body, {
                abortEarly: false,
                stripUnknown: true
            });
            if (error) {
                const errors = error.details.map((detail) => ({
                    field: detail.path.join('.'),
                    message: detail.message.replace(/"/g, ''),
                    type: detail.type
                }));
                return res.status(400).json({
                    error: 'Validation failed',
                    code: 'VALIDATION_ERROR',
                    details: errors
                });
            }
            req.body = value;
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
exports.validateRequest = validateRequest;
const logActivity = (action, entityType) => {
    return async (req, res, next) => {
        const originalSend = res.send;
        const user = req.user;
        res.send = function (body) {
            res.send = originalSend;
            if (res.statusCode >= 200 && res.statusCode < 300 && user) {
                try {
                    let entityId;
                    if (req.params.id) {
                        entityId = req.params.id;
                    }
                    else if (req.body.id) {
                        entityId = req.body.id;
                    }
                    const finalEntityType = entityType ||
                        req.baseUrl.split('/').pop()?.toUpperCase() ||
                        'UNKNOWN';
                    prisma_1.prisma.activityLog.create({
                        data: {
                            userId: user.id,
                            action,
                            entityType: finalEntityType,
                            entityId: entityId || 'N/A',
                            details: {
                                method: req.method,
                                path: req.path,
                                params: req.params,
                                body: req.method === 'GET' ? undefined : req.body,
                                statusCode: res.statusCode,
                                userAgent: req.get('user-agent'),
                                ip: req.ip
                            }
                        }
                    }).catch(console.error);
                }
                catch (error) {
                    console.error('Failed to log activity:', error);
                }
            }
            return originalSend.call(this, body);
        };
        next();
    };
};
exports.logActivity = logActivity;
//# sourceMappingURL=auth.js.map