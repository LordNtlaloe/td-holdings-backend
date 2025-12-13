import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        public message: string,
        public isOperational: boolean = true,
        public code?: string
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, code?: string) {
        super(400, message, true, code);
    }
}

export class AuthenticationError extends AppError {
    constructor(message: string, code?: string) {
        super(401, message, true, code);
    }
}

export class AuthorizationError extends AppError {
    constructor(message: string, code?: string) {
        super(403, message, true, code);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string, code?: string) {
        super(404, message, true, code);
    }
}

export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    console.error('Error:', {
        name: err.name,
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        user: (req as any).user?.userId,
        ip: req.ip
    });

    // Handle Prisma errors
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const prismaError = handlePrismaError(err);
        res.status(prismaError.statusCode).json(prismaError);
        return;
    }

    if (err instanceof Prisma.PrismaClientUnknownRequestError) {
        res.status(500).json({
            error: 'DATABASE_ERROR',
            message: 'An unknown database error occurred',
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (err instanceof Prisma.PrismaClientValidationError) {
        res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Database validation failed',
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Handle custom AppErrors
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: err.code || err.name,
            message: err.message,
            timestamp: new Date().toISOString(),
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
        return;
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        res.status(401).json({
            error: 'INVALID_TOKEN',
            message: 'Invalid authentication token',
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (err.name === 'TokenExpiredError') {
        res.status(401).json({
            error: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired',
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Handle Joi validation errors
    if (err.name === 'ValidationError' && (err as any).details) {
        const validationError = err as any;
        res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: validationError.details.map((detail: any) => ({
                field: detail.path.join('.'),
                message: detail.message,
                type: detail.type
            })),
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Default error
    res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: process.env.NODE_ENV === 'production'
            ? 'An internal server error occurred'
            : err.message,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && {
            stack: err.stack,
            name: err.name
        })
    });
};

const handlePrismaError = (err: Prisma.PrismaClientKnownRequestError) => {
    switch (err.code) {
        case 'P2002':
            return {
                statusCode: 409,
                error: 'DUPLICATE_ENTRY',
                message: `A record with this ${err.meta?.target} already exists`,
                timestamp: new Date().toISOString()
            };
        case 'P2003':
            return {
                statusCode: 400,
                error: 'FOREIGN_KEY_CONSTRAINT',
                message: 'Foreign key constraint failed',
                timestamp: new Date().toISOString()
            };
        case 'P2025':
            return {
                statusCode: 404,
                error: 'RECORD_NOT_FOUND',
                message: 'The requested record was not found',
                timestamp: new Date().toISOString()
            };
        case 'P2016':
            return {
                statusCode: 400,
                error: 'INVALID_RELATION',
                message: 'Invalid relation provided',
                timestamp: new Date().toISOString()
            };
        case 'P2000':
            return {
                statusCode: 400,
                error: 'VALUE_TOO_LONG',
                message: 'The provided value is too long for the column',
                timestamp: new Date().toISOString()
            };
        case 'P2001':
            return {
                statusCode: 404,
                error: 'RECORD_NOT_FOUND',
                message: 'No record found for the given condition',
                timestamp: new Date().toISOString()
            };
        default:
            return {
                statusCode: 500,
                error: 'DATABASE_ERROR',
                message: 'An unexpected database error occurred',
                timestamp: new Date().toISOString()
            };
    }
};

// Helper function to create errors
export const createError = {
    validation: (message: string, code?: string) => new ValidationError(message, code),
    authentication: (message: string, code?: string) => new AuthenticationError(message, code),
    authorization: (message: string, code?: string) => new AuthorizationError(message, code),
    notFound: (message: string, code?: string) => new NotFoundError(message, code),
    conflict: (message: string, code?: string) => new AppError(409, message, true, code),
    badRequest: (message: string, code?: string) => new AppError(400, message, true, code),
    internal: (message: string, code?: string) => new AppError(500, message, false, code)
};