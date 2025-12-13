import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { sendEmail } from "../../lib/mail";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}

if (!JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET is not defined in environment variables');
}

/**
 * TOKEN CONTROLLER: Token lifecycle management
 * 
 * Owns: RefreshToken operations
 * Coordinates: User validation, session management
 * 
 * Key Invariants:
 * 1. Refresh tokens are single-use (rotate on use)
 * 2. Tokens expire and must be renewed
 * 3. Token revocation cascades to all dependent tokens
 */

// ============ REFRESH TOKEN MANAGEMENT ============

/**
 * Refresh access token using refresh token
 * Implements token rotation for security
 * 
 * @param refreshToken Refresh token string
 * @param userAgent Optional client identifier for logging
 */
export const refreshAccessToken = async (
    refreshToken: string,
    userAgent?: string
): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: any;
}> => {
    if (!refreshToken) {
        throw new Error("REFRESH_TOKEN_REQUIRED: Refresh token is required");
    }

    // Transaction: Validate + rotate tokens atomically
    return await prisma.$transaction(async (tx) => {
        // Find valid, unrevoked refresh tokens
        const activeTokens = await tx.refreshToken.findMany({
            where: {
                revoked: false,
                expiresAt: { gt: new Date() }
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        role: true,
                        isActive: true,
                        isVerified: true,
                        storeId: true
                    }
                }
            }
        });

        // Find matching token by comparing hash
        let validToken = null;
        for (const token of activeTokens) {
            const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
            if (isValid) {
                validToken = token;
                break;
            }
        }

        if (!validToken) {
            throw new Error("INVALID_REFRESH_TOKEN: Token is invalid, revoked, or expired");
        }

        // Check if user is still active
        if (!validToken.user.isActive) {
            throw new Error("ACCOUNT_INACTIVE: User account is deactivated");
        }

        if (!validToken.user.isVerified) {
            throw new Error("ACCOUNT_UNVERIFIED: User account is not verified");
        }

        // Generate new access token
        const accessToken = jwt.sign(
            {
                userId: validToken.user.id,
                email: validToken.user.email,
                role: validToken.user.role,
                storeId: validToken.user.storeId
            },
            JWT_SECRET,
            { expiresIn: "24h" }
        );

        // Generate new refresh token (rotate)
        const newRefreshToken = crypto.randomBytes(40).toString("hex");
        const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);

        // Revoke old token and create new one
        await tx.refreshToken.update({
            where: { id: validToken.id },
            data: { revoked: true }
        });

        await tx.refreshToken.create({
            data: {
                userId: validToken.user.id,
                tokenHash: newRefreshTokenHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                revoked: false,
                replacedById: validToken.id,
                createdAt: new Date()
            }
        });

        // Log token refresh activity
        await tx.activityLog.create({
            data: {
                userId: validToken.user.id,
                action: "TOKEN_REFRESHED",
                entityType: "USER",
                entityId: validToken.user.id,
                details: { userAgent, tokenRotation: true },
                createdAt: new Date()
            }
        });

        // Return user data (excluding sensitive fields)
        const userData = {
            id: validToken.user.id,
            email: validToken.user.email,
            firstName: validToken.user.firstName,
            lastName: validToken.user.lastName,
            role: validToken.user.role,
            isActive: validToken.user.isActive,
            isVerified: validToken.user.isVerified,
            storeId: validToken.user.storeId
        };

        return {
            accessToken,
            refreshToken: newRefreshToken,
            expiresIn: 24 * 60 * 60, // 24 hours in seconds
            user: userData
        };
    });
};

/**
 * Get active sessions for a user
 * Lists all unrevoked refresh tokens
 * 
 * @param userId User ID
 */
export const getUserSessions = async (
    userId: string
): Promise<Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date;
    revoked: boolean;
    userAgent?: string;
    ipAddress?: string;
}>> => {
    const sessions = await prisma.refreshToken.findMany({
        where: {
            userId,
            expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            revoked: true
            // Note: In production, you might store userAgent and ipAddress
            // when creating the token
        }
    });

    return sessions;
};

/**
 * Revoke specific session by token ID
 * 
 * @param tokenId Refresh token ID
 * @param performedBy User ID performing revocation
 */
export const revokeSession = async (
    tokenId: string,
    performedBy: string
): Promise<void> => {
    // Transaction: Revoke token + log activity atomically
    await prisma.$transaction(async (tx) => {
        const token = await tx.refreshToken.findUnique({
            where: { id: tokenId },
            include: { user: true }
        });

        if (!token) {
            throw new Error("TOKEN_NOT_FOUND: Refresh token not found");
        }

        // Check if already revoked
        if (token.revoked) {
            throw new Error("TOKEN_ALREADY_REVOKED: Token is already revoked");
        }

        // Revoke token
        await tx.refreshToken.update({
            where: { id: tokenId },
            data: { revoked: true }
        });

        // Also revoke any tokens that replaced this one
        await tx.refreshToken.updateMany({
            where: { replacedById: tokenId },
            data: { revoked: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: performedBy,
                action: "SESSION_REVOKED",
                entityType: "REFRESH_TOKEN",
                entityId: tokenId,
                details: {
                    targetUserId: token.userId,
                    revokedBy: performedBy
                },
                createdAt: new Date()
            }
        });
    });
};

/**
 * Clean up expired tokens (cron job)
 * Removes expired refresh tokens from database
 */
export const cleanupExpiredTokens = async (): Promise<{
    removed: number;
    revokedExpired: number;
}> => {
    const now = new Date();

    // Remove tokens that expired more than 7 days ago
    const expiredCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [removedCount] = await Promise.all([
        // Delete old expired tokens
        prisma.refreshToken.deleteMany({
            where: {
                expiresAt: { lt: expiredCutoff }
            }
        }),
        // Revoke tokens that just expired
        prisma.refreshToken.updateMany({
            where: {
                expiresAt: { lt: now, gt: expiredCutoff },
                revoked: false
            },
            data: { revoked: true }
        })
    ]);

    // Count revoked tokens
    const revokedCount = await prisma.refreshToken.count({
        where: {
            expiresAt: { lt: now, gt: expiredCutoff },
            revoked: true
        }
    });

    return {
        removed: removedCount.count,
        revokedExpired: revokedCount
    };
};

// ============ VERIFICATION CODE MANAGEMENT ============

/**
 * Resend verification code to user email
 * Invalidates previous codes and generates new one
 * 
 * @param email User email
 */
export const resendVerificationCode = async (
    email: string
): Promise<{ verificationCode: string; expiresAt: Date }> => {
    if (!email) {
        throw new Error("EMAIL_REQUIRED: Email address is required");
    }

    // Transaction: Invalidate old codes + create new one atomically
    return await prisma.$transaction(async (tx) => {
        // Find user
        const user = await tx.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: No user found with this email");
        }

        // Check if already verified
        if (user.isVerified) {
            throw new Error("ALREADY_VERIFIED: Account is already verified");
        }

        // Invalidate any existing verification codes
        await tx.verificationCode.updateMany({
            where: {
                userId: user.id,
                used: false,
                expiresAt: { gt: new Date() }
            },
            data: { used: true }
        });

        // Generate new verification code
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Create new verification code
        await tx.verificationCode.create({
            data: {
                userId: user.id,
                code: verificationCode,
                expiresAt,
                used: false,
                createdAt: new Date()
            }
        });

        // Send verification email
        await sendEmail(
            email,
            "Your New Verification Code",
            `Your new verification code is: ${verificationCode}\n\nThis code will expire in 24 hours.\n\nIf you didn't request this, please ignore this email.`
        );

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "VERIFICATION_CODE_RESENT",
                entityType: "USER",
                entityId: user.id,
                details: { deliveryMethod: "EMAIL" },
                createdAt: new Date()
            }
        });

        return { verificationCode, expiresAt };
    });
};

/**
 * Validate verification code
 * Checks if code is valid and not expired
 * 
 * @param userId User ID
 * @param code Verification code
 */
export const validateVerificationCode = async (
    userId: string,
    code: string
): Promise<{ isValid: boolean; expiresAt?: Date }> => {
    const verificationCode = await prisma.verificationCode.findFirst({
        where: {
            userId,
            code,
            used: false,
            expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (!verificationCode) {
        return { isValid: false };
    }

    return {
        isValid: true,
        expiresAt: verificationCode.expiresAt
    };
};

/**
 * Clean up used/expired verification codes (cron job)
 */
export const cleanupVerificationCodes = async (): Promise<{ removed: number }> => {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const result = await prisma.verificationCode.deleteMany({
        where: {
            OR: [
                { used: true },
                { expiresAt: { lt: cutoffDate } }
            ]
        }
    });

    return { removed: result.count };
};

// ============ PASSWORD RESET TOKEN MANAGEMENT ============

/**
 * Validate password reset token
 * 
 * @param email User email
 * @param resetToken Reset token
 */
export const validatePasswordResetToken = async (
    email: string,
    resetToken: string
): Promise<{ isValid: boolean; expiresAt?: Date }> => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        return { isValid: false };
    }

    const resetRecord = await prisma.passwordReset.findFirst({
        where: {
            userId: user.id,
            used: false,
            expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (!resetRecord) {
        return { isValid: false };
    }

    // Verify token hash
    const tokenValid = await bcrypt.compare(resetToken, resetRecord.tokenHash);
    if (!tokenValid) {
        return { isValid: false };
    }

    return {
        isValid: true,
        expiresAt: resetRecord.expiresAt
    };
};

/**
 * Clean up used/expired password reset tokens (cron job)
 */
export const cleanupPasswordResetTokens = async (): Promise<{ removed: number }> => {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const result = await prisma.passwordReset.deleteMany({
        where: {
            OR: [
                { used: true },
                { expiresAt: { lt: cutoffDate } }
            ]
        }
    });

    return { removed: result.count };
};

// ============ TOKEN VALIDATION MIDDLEWARE HELPERS ============

/**
 * Validate API key for service-to-service communication
 * 
 * @param apiKey API key string
 */
export const validateApiKey = async (
    apiKey: string
): Promise<{ isValid: boolean; service?: string; permissions?: string[] }> => {
    // Note: In production, you'd store API keys in a separate table
    // with associated service names and permissions

    // This is a simplified implementation
    const validKeys = process.env.API_KEYS?.split(',') || [];
    const keyIndex = validKeys.findIndex(k => k === apiKey);

    if (keyIndex === -1) {
        return { isValid: false };
    }

    // Map key index to service name (simplified)
    const services = ['INVENTORY_SYNC', 'REPORTING', 'BACKUP'];
    const service = services[keyIndex] || 'UNKNOWN';

    // Define permissions per service
    const permissionsMap: Record<string, string[]> = {
        'INVENTORY_SYNC': ['inventory:read', 'inventory:write'],
        'REPORTING': ['reports:read'],
        'BACKUP': ['backup:read', 'backup:write']
    };

    return {
        isValid: true,
        service,
        permissions: permissionsMap[service] || []
    };
};

/**
 * Generate short-lived token for specific operation
 * 
 * @param userId User ID
 * @param operation Operation type (e.g., 'email-change', '2fa')
 * @param expiresIn Seconds until expiration
 */
export const generateOperationToken = async (
    userId: string,
    operation: string,
    expiresIn: number = 300 // 5 minutes default
): Promise<{ token: string; expiresAt: Date }> => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(token, 10);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Store token in database (you might want a separate table for operation tokens)
    // For now, we'll use the existing password reset table for simplicity
    await prisma.passwordReset.create({
        data: {
            userId,
            tokenHash,
            expiresAt,
            used: false,
            createdAt: new Date()
        }
    });

    return { token, expiresAt };
};

/**
 * Validate operation token
 * 
 * @param userId User ID
 * @param token Operation token
 * @param operation Operation type
 */
export const validateOperationToken = async (
    userId: string,
    token: string,
    operation: string
): Promise<{ isValid: boolean; expiresAt?: Date }> => {
    // Find the most recent token for this user
    const tokenRecord = await prisma.passwordReset.findFirst({
        where: {
            userId,
            used: false,
            expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (!tokenRecord) {
        return { isValid: false };
    }

    // Verify token
    const tokenValid = await bcrypt.compare(token, tokenRecord.tokenHash);
    if (!tokenValid) {
        return { isValid: false };
    }

    return {
        isValid: true,
        expiresAt: tokenRecord.expiresAt
    };
};

// ============ HELPER FUNCTIONS ============

function generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}