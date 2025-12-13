import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Different rate limits for different endpoints
export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: false,
    skip: (req: Request) => {
        // Skip rate limiting for health checks
        if (req.path === '/health' || req.path === '/health/readiness' || req.path === '/health/liveness') {
            return true;
        }
        // Skip for certain IPs (e.g., monitoring, internal services)
        const whitelistIPs = process.env.RATE_LIMIT_WHITELIST?.split(',') || [];
        return whitelistIPs.includes(req.ip || '');
    },
    message: {
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests from this IP, please try again later',
        retryAfter: 15 * 60, // 15 minutes in seconds
        timestamp: new Date().toISOString()
    }
});

// Stricter limiter for authentication endpoints
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'TOO_MANY_AUTH_ATTEMPTS',
        message: 'Too many authentication attempts, please try again later',
        retryAfter: 15 * 60,
        timestamp: new Date().toISOString()
    }
});

// Stricter limiter for password reset endpoints
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'TOO_MANY_PASSWORD_RESETS',
        message: 'Too many password reset attempts, please try again later',
        retryAfter: 60 * 60, // 1 hour in seconds
        timestamp: new Date().toISOString()
    }
});