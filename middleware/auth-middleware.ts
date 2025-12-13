import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET as string;

interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
        role: string;
        storeId?: string;
    };
}

/**
 * Middleware to validate JWT token and attach user to request
 */
export const authenticateToken = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Get token from Authorization header or cookies
        const authHeader = req.headers.authorization;
        const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;

        const tokenFromCookie = req.cookies?.accessToken;
        const token = tokenFromHeader || tokenFromCookie;

        if (!token) {
            res.status(401).json({ error: "ACCESS_TOKEN_REQUIRED: No access token provided" });
            return;
        }

        // Verify token
        let decoded: any;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (jwtError: any) {
            if (jwtError.name === "TokenExpiredError") {
                res.status(401).json({ error: "TOKEN_EXPIRED: Access token has expired" });
                return;
            }
            res.status(401).json({ error: "INVALID_TOKEN: Invalid access token" });
            return;
        }

        // Verify user still exists and is active
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                isVerified: true,
                storeId: true
            }
        });

        if (!user) {
            res.status(401).json({ error: "USER_NOT_FOUND: User no longer exists" });
            return;
        }

        if (!user.isActive) {
            res.status(403).json({ error: "ACCOUNT_INACTIVE: Account is deactivated" });
            return;
        }

        if (!user.isVerified) {
            res.status(403).json({ error: "ACCOUNT_UNVERIFIED: Account is not verified" });
            return;
        }

        // Attach user to request
        req.user = {
            userId: user.id,
            email: user.email,
            role: user.role,
            storeId: user.storeId || undefined
        };

        next();
    } catch (error) {
        console.error("Authentication middleware error:", error);
        res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
    }
};

/**
 * Middleware to require specific role(s)
 */
export const requireRole = (...allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: "UNAUTHORIZED: Authentication required" });
            return;
        }

        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({
                error: "FORBIDDEN: Insufficient permissions",
                requiredRoles: allowedRoles,
                userRole: req.user.role
            });
            return;
        }

        next();
    };
};

/**
 * Middleware to require store assignment
 */
export const requireStoreAssignment = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): void => {
    if (!req.user) {
        res.status(401).json({ error: "UNAUTHORIZED: Authentication required" });
        return;
    }

    if (!req.user.storeId) {
        res.status(403).json({
            error: "STORE_ASSIGNMENT_REQUIRED: User must be assigned to a store"
        });
        return;
    }

    next();
};

/**
 * Middleware to validate store access (user must be assigned to the store they're accessing)
 */
export const validateStoreAccess = (
    paramName: string = "storeId"
) => {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            res.status(401).json({ error: "UNAUTHORIZED: Authentication required" });
            return;
        }

        // For store managers/admins, they can access any store
        if (req.user.role === "ADMIN" || req.user.role === "MANAGER") {
            next();
            return;
        }

        // For cashiers, they can only access their assigned store
        const storeIdFromParam = req.params[paramName] || req.body.storeId;

        if (!storeIdFromParam) {
            res.status(400).json({ error: "STORE_ID_REQUIRED: Store ID is required" });
            return;
        }

        if (req.user.storeId !== storeIdFromParam) {
            res.status(403).json({
                error: "STORE_ACCESS_DENIED: You can only access your assigned store",
                userStoreId: req.user.storeId,
                requestedStoreId: storeIdFromParam
            });
            return;
        }

        next();
    };
};

/**
 * Middleware to refresh token if expired (optional)
 */
export const refreshTokenIfNeeded = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    // This would check for refresh token and issue new access token
    // Typically handled separately in auth routes
    next();
};