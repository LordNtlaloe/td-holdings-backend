// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    storeId?: string;
    employeeId?: string;
  };
}

// Token verification middleware
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Check if token has required data
    if (!decoded.userId || !decoded.email || !decoded.role) {
      return res.status(401).json({ 
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN'
      });
    }

    // Find user with employee and store info
    const user = await prisma.user.findUnique({
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

    // Check if user is active
    if (user.isActive === false) {
      return res.status(403).json({ 
        error: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Check if email is verified (if required)
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
      return res.status(403).json({ 
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      storeId: user.employee?.storeId,
      employeeId: user.employee?.id
    };

    next();
  } catch (error: any) {
    // Handle different JWT errors
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

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
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

// Store access control middleware
export const requireStoreAccess = (options?: { allowAdmin?: boolean }) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { storeId } = req.params;
      const user = req.user!;

      const allowAdmin = options?.allowAdmin ?? true;

      // Admin bypass
      if (allowAdmin && user.role === 'ADMIN') {
        return next();
      }

      // If no storeId in params, use body or query
      const targetStoreId = storeId || req.body.storeId || req.query.storeId;

      if (!targetStoreId) {
        return res.status(400).json({ 
          error: 'Store ID is required',
          code: 'STORE_ID_REQUIRED'
        });
      }

      // For managers and cashiers, verify they belong to the store
      const employee = await prisma.employee.findFirst({
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
    } catch (error) {
      next(error);
    }
  };
};

// Self-access or manager access middleware
export const requireEmployeeAccess = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { employeeId } = req.params;
      const user = req.user!;

      if (!employeeId) {
        return res.status(400).json({ 
          error: 'Employee ID is required',
          code: 'EMPLOYEE_ID_REQUIRED'
        });
      }

      // Admin can access any employee
      if (user.role === 'ADMIN') {
        return next();
      }

      // Get the target employee
      const targetEmployee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { store: true }
      });

      if (!targetEmployee) {
        return res.status(404).json({ 
          error: 'Employee not found',
          code: 'EMPLOYEE_NOT_FOUND'
        });
      }

      // Check if user is accessing their own data
      if (user.employeeId === employeeId) {
        return next();
      }

      // Check if manager is accessing employee in their store
      if (user.role === 'MANAGER' && user.storeId === targetEmployee.storeId) {
        return next();
      }

      return res.status(403).json({ 
        error: 'Access denied to this employee data',
        code: 'EMPLOYEE_ACCESS_DENIED'
      });
    } catch (error) {
      next(error);
    }
  };
};

// Product access control middleware
export const requireProductAccess = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const user = req.user!;

      if (!productId) {
        return res.status(400).json({ 
          error: 'Product ID is required',
          code: 'PRODUCT_ID_REQUIRED'
        });
      }

      // Get the product
      const product = await prisma.product.findUnique({
        where: { id: productId }
      });

      if (!product) {
        return res.status(404).json({ 
          error: 'Product not found',
          code: 'PRODUCT_NOT_FOUND'
        });
      }

      // Admin can access any product
      if (user.role === 'ADMIN') {
        return next();
      }

      // Check if user has access to the product's store
      if (user.storeId === product.storeId) {
        return next();
      }

      // Check if product is shared between stores
      const storeProduct = await prisma.storeProduct.findUnique({
        where: {
          productId_storeId: {
            productId,
            storeId: user.storeId!
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
    } catch (error) {
      next(error);
    }
  };
};

// Sale access control middleware
export const requireSaleAccess = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { saleId } = req.params;
      const user = req.user!;

      if (!saleId) {
        return res.status(400).json({ 
          error: 'Sale ID is required',
          code: 'SALE_ID_REQUIRED'
        });
      }

      // Get the sale
      const sale = await prisma.sale.findUnique({
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

      // Admin can access any sale
      if (user.role === 'ADMIN') {
        return next();
      }

      // Check if user created the sale
      if (user.employeeId === sale.employeeId) {
        return next();
      }

      // Check if manager is accessing sale from their store
      if (user.role === 'MANAGER' && user.storeId === sale.storeId) {
        return next();
      }

      return res.status(403).json({ 
        error: 'Access denied to this sale',
        code: 'SALE_ACCESS_DENIED'
      });
    } catch (error) {
      next(error);
    }
  };
};

// Rate limiting middleware (optional but recommended)
export const rateLimit = (options: {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) => {
  const requests = new Map();
  
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.keyGenerator 
      ? options.keyGenerator(req) 
      : req.ip || 'unknown';
    
    const now = Date.now();
    const windowStart = now - options.windowMs;
    
    // Clean up old entries
    const recentRequests = (requests.get(key) || []).filter(
      (timestamp: number) => timestamp > windowStart
    );
    
    // Check if rate limit exceeded
    if (recentRequests.length >= options.max) {
      return res.status(429).json({
        error: options.message || 'Too many requests, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((recentRequests[0] + options.windowMs - now) / 1000)
      });
    }
    
    // Add current request
    recentRequests.push(now);
    requests.set(key, recentRequests);
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', options.max - recentRequests.length);
    res.setHeader('X-RateLimit-Reset', new Date(now + options.windowMs).toISOString());
    
    next();
  };
};

// Request validation middleware
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errors = error.details.map((detail: any) => ({
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

      // Replace body with validated values
      req.body = value;
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Activity logging middleware
export const logActivity = (action: string, entityType?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const user = req.user;
    
    // Override res.send to log after response
    res.send = function(body: any) {
      res.send = originalSend;
      
      // Only log successful operations (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300 && user) {
        try {
          // Extract entity ID from request
          let entityId: string | undefined;
          
          if (req.params.id) {
            entityId = req.params.id;
          } else if (req.body.id) {
            entityId = req.body.id;
          }
          
          // Determine entity type from request if not provided
          const finalEntityType = entityType || 
            req.baseUrl.split('/').pop()?.toUpperCase() || 
            'UNKNOWN';
          
          // Log activity in background (don't wait for it)
          prisma.activityLog.create({
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
        } catch (error) {
          console.error('Failed to log activity:', error);
        }
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
};