// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

interface TokenPayload {
  userId: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    storeId?: string;
  };
}


export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    console.log('🟦 Auth Middleware - Checking token...');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('🔴 No Bearer token found');
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    console.log('🟦 Token decoded successfully, user ID:', decoded.userId);

    // Fetch user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        storeId: true,
        isActive: true,
        isVerified: true
      }
    });

    if (!user) {
      console.log('🔴 User not found in database:', decoded.userId);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (!user.isActive) {
      console.log('🔴 User account is inactive:', user.email);
      res.status(403).json({ error: 'Account is deactivated' });
      return;
    }

    if (!user.isVerified) {
      console.log('🔴 User account not verified:', user.email);
      res.status(403).json({ error: 'Account not verified' });
      return;
    }

    console.log('🟦 User authenticated successfully:', user.email);

    // Attach the complete user object to the request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      storeId: user.storeId || undefined
    };

    next();
  } catch (error: any) {
    console.error('🔴 Authentication error:', error.message);

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Token expired',
        expiredAt: error.expiredAt,
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

export const requireStoreAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.storeId) {
    res.status(403).json({ error: 'Store access required' });
    return;
  }
  next();
};

export const authorizeStoreAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { storeId } = req.params;

    // Admins can access any store
    if (req.user.role === 'ADMIN') {
      next();
      return;
    }

    // Managers can access any store
    if (req.user.role === 'MANAGER') {
      next();
      return;
    }

    // Cashiers/Employees can only access their assigned store
    if (req.user.role === 'CASHIER') {
      if (req.user.storeId !== storeId) {
        res.status(403).json({
          error: 'You can only access your assigned store'
        });
        return;
      }
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};