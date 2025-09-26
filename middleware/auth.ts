import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        role: string;
        employeeId?: string;
        storeId?: string;
    };
}

// Verify JWT Token
export const authenticateToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({ error: "Access token required" });
        }

        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

        // Get user details including role and employee info
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                employee: {
                    select: {
                        id: true,
                        storeId: true,
                    },
                },
            },
        });

        if (!user || !user.isVerified) {
            return res.status(401).json({ error: "Invalid or unverified user" });
        }

        req.user = {
            userId: user.id,
            role: user.role,
            employeeId: user.employee?.id,
            storeId: user.employee?.storeId,
        };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ error: "Token expired" });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: "Invalid token" });
        }
        console.error("Authentication error:", error);
        return res.status(500).json({ error: "Authentication failed" });
    }
};

// Authorization middleware for roles
export const requireRole = (allowedRoles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: "Insufficient permissions",
                required: allowedRoles,
                current: req.user.role
            });
        }

        next();
    };
};

// Admin only access
export const requireAdmin = requireRole(['ADMIN']);

// Manager or Admin access
export const requireManagerOrAdmin = requireRole(['MANAGER', 'ADMIN']);

// Any authenticated employee
export const requireEmployee = requireRole(['CASHIER', 'MANAGER', 'ADMIN']);

// Store-specific access control
export const requireStoreAccess = (allowStoreParam = true) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Admins have access to all stores
        if (req.user.role === 'ADMIN') {
            return next();
        }

        // Get store ID from params, query, or body
        const storeId = req.params.storeId || req.query.storeId || req.body.storeId;

        if (!storeId && allowStoreParam) {
            return res.status(400).json({ error: "Store ID required" });
        }

        // If store ID is provided, check if user has access
        if (storeId && req.user.storeId && storeId !== req.user.storeId) {
            return res.status(403).json({
                error: "Access denied to this store",
                userStoreId: req.user.storeId,
                requestedStoreId: storeId
            });
        }

        // If no store ID in request but user has a store, inject it
        if (!storeId && req.user.storeId) {
            if (req.method === 'GET') {
                req.query.storeId = req.user.storeId;
            } else {
                req.body.storeId = req.user.storeId;
            }
        }

        next();
    };
};

// Employee can only access their own data or managers/admins can access any employee in their store
export const requireEmployeeAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    // Admins can access any employee data
    if (req.user.role === 'ADMIN') {
        return next();
    }

    const requestedEmployeeId = req.params.employeeId || req.params.id;

    // Users can access their own employee data
    if (req.user.employeeId === requestedEmployeeId) {
        return next();
    }

    // Managers can access employees in their store
    if (req.user.role === 'MANAGER' && req.user.storeId) {
        return next(); // Store access will be validated by requireStoreAccess if needed
    }

    return res.status(403).json({ error: "Access denied to this employee data" });
};

// Validate store ownership for operations
export const validateStoreOwnership = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Admins can access any store
        if (req.user.role === 'ADMIN') {
            return next();
        }

        const storeId = req.params.storeId || req.query.storeId || req.body.storeId;

        if (!storeId) {
            return res.status(400).json({ error: "Store ID required" });
        }

        // Check if the user's employee record belongs to this store
        if (req.user.employeeId) {
            const employee = await prisma.employee.findUnique({
                where: { id: req.user.employeeId },
                select: { storeId: true },
            });

            if (!employee || employee.storeId !== storeId) {
                return res.status(403).json({ error: "Access denied to this store" });
            }
        }

        next();
    } catch (error) {
        console.error("Store ownership validation error:", error);
        res.status(500).json({ error: "Authorization check failed" });
    }
};

// Refresh token validation
export const validateRefreshToken = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ error: "Refresh token required" });
        }

        const tokenRecord = await prisma.refreshToken.findFirst({
            where: {
                revoked: false,
                expiresAt: { gt: new Date() },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        isVerified: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!tokenRecord) {
            return res.status(401).json({ error: "Invalid or expired refresh token" });
        }

        // Verify the token hash
        const bcrypt = require('bcrypt');
        const isValidToken = await bcrypt.compare(refreshToken, tokenRecord.tokenHash);

        if (!isValidToken) {
            return res.status(401).json({ error: "Invalid refresh token" });
        }

        if (!tokenRecord.user.isVerified) {
            return res.status(401).json({ error: "User account not verified" });
        }

        // Attach user and token info to request
        (req as any).user = tokenRecord.user;
        (req as any).tokenRecord = tokenRecord;

        next();
    } catch (error) {
        console.error("Refresh token validation error:", error);
        res.status(500).json({ error: "Token validation failed" });
    }
};

// Rate limiting middleware (basic implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimit = (maxRequests: number, windowMs: number) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const identifier = req.ip || 'unknown';
        const now = Date.now();

        const requestData = requestCounts.get(identifier);

        if (!requestData || now > requestData.resetTime) {
            // Reset or initialize counter
            requestCounts.set(identifier, {
                count: 1,
                resetTime: now + windowMs,
            });
            return next();
        }

        if (requestData.count >= maxRequests) {
            return res.status(429).json({
                error: "Too many requests",
                retryAfter: Math.ceil((requestData.resetTime - now) / 1000),
            });
        }

        requestData.count++;
        next();
    };
};

// Input validation middleware
export const validateRequiredFields = (fields: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const missingFields = fields.filter(field => {
            const value = req.body[field];
            return value === undefined || value === null ||
                (typeof value === 'string' && value.trim() === '');
        });

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: "Missing required fields",
                missing: missingFields,
            });
        }

        next();
    };
};

// Sanitize input middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
    const sanitizeValue = (value: any): any => {
        if (typeof value === 'string') {
            // Basic XSS protection - remove script tags and javascript: protocol
            return value
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/javascript:/gi, '')
                .trim();
        }

        if (Array.isArray(value)) {
            return value.map(sanitizeValue);
        }

        if (value && typeof value === 'object') {
            const sanitized: any = {};
            for (const key in value) {
                sanitized[key] = sanitizeValue(value[key]);
            }
            return sanitized;
        }

        return value;
    };

    req.body = sanitizeValue(req.body);
    next();
};

// Error handling middleware
export const errorHandler = (
    error: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.error('Error:', error);

    // Prisma errors
    if (error.code === 'P2002') {
        return res.status(400).json({
            error: "A record with this information already exists",
            field: error.meta?.target,
        });
    }

    if (error.code === 'P2025') {
        return res.status(404).json({
            error: "Record not found",
        });
    }

    // Validation errors
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: "Validation failed",
            details: error.message,
        });
    }

    // JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: "Invalid token",
        });
    }

    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: "Token expired",
        });
    }

    // Default error
    res.status(500).json({
        error: "Internal server error",
        ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
};