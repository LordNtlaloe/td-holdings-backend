import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { Role } from "@prisma/client";
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
 * AUTH CONTROLLER: User authentication and account management
 * 
 * Owns: User (auth fields only), RefreshToken, VerificationCode, PasswordReset
 * 
 * Key Invariants:
 * 1. Password must be hashed before storage
 * 2. Email must be unique across all users
 * 3. Only active users can authenticate
 * 4. Refresh tokens must be single-use and expire
 */

// ============ REGISTRATION & ACCOUNT SETUP ============

/**
 * Register a new user account
 * Creates user with hashed password and optional store assignment
 * 
 * @param email User email (must be unique)
 * @param password Plain text password (will be hashed)
 * @param firstName User first name
 * @param lastName User last name
 * @param phone User phone number
 * @param role User role (ADMIN, MANAGER, CASHIER)
 * @param storeId Optional store assignment for employee
 */
export const registerUser = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone: string,
    role: Role = Role.CASHIER,
    storeId?: string
): Promise<{ user: any; verificationCode?: string }> => {
    // Validate required fields
    if (!email || !password || !firstName || !lastName || !phone) {
        throw new Error("MISSING_REQUIRED_FIELDS: Email, password, name, and phone are required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error("INVALID_EMAIL_FORMAT: Please provide a valid email address");
    }

    // Validate password strength
    if (password.length < 8) {
        throw new Error("WEAK_PASSWORD: Password must be at least 8 characters long");
    }

    // Transaction: Create user + verification code atomically
    return await prisma.$transaction(async (tx) => {
        // Check if user already exists
        const existingUser = await tx.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new Error("USER_EXISTS: A user with this email already exists");
        }

        // Validate store exists if provided
        if (storeId) {
            const store = await tx.store.findUnique({ where: { id: storeId } });
            if (!store) {
                throw new Error("STORE_NOT_FOUND: Specified store does not exist");
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Determine if user should be active based on role
        const isActive = role !== Role.CASHIER; // Cashiers need activation
        const emailVerified = role !== Role.CASHIER ? new Date() : null;

        // Create user
        const user = await tx.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName,
                lastName,
                phone,
                role,
                isActive,
                isVerified: isActive,
                lastLogin: null,
                storeId,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                isActive: true,
                isVerified: true,
                storeId: true,
                createdAt: true
            }
        });

        // Generate verification code for cashiers
        let verificationCode: string | undefined;
        if (role === Role.CASHIER) {
            verificationCode = generateVerificationCode();

            await tx.verificationCode.create({
                data: {
                    userId: user.id,
                    code: verificationCode,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                    used: false,
                    createdAt: new Date()
                }
            });

            // Send verification email
            await sendEmail(
                email,
                "Verify Your Account",
                `Welcome to the inventory system! Your verification code is: ${verificationCode}\n\nThis code will expire in 24 hours.`
            );
        }

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "USER_REGISTERED",
                entityType: "USER",
                entityId: user.id,
                details: { role, storeId, autoActivated: isActive },
                createdAt: new Date()
            }
        });

        return { user, verificationCode };
    });
};

/**
 * Verify user account with verification code
 * Activates user and marks email as verified
 * 
 * @param email User email
 * @param code Verification code
 */
export const verifyAccount = async (
    email: string,
    code: string
): Promise<{ user: any }> => {
    if (!email || !code) {
        throw new Error("MISSING_REQUIRED_FIELDS: Email and verification code are required");
    }

    // Transaction: Verify code + activate user atomically
    return await prisma.$transaction(async (tx) => {
        // Find user
        const user = await tx.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: No user found with this email");
        }

        // Check if already verified
        if (user.isVerified) {
            throw new Error("ALREADY_VERIFIED: This account is already verified");
        }

        // Find valid verification code
        const verificationRecord = await tx.verificationCode.findFirst({
            where: {
                userId: user.id,
                code,
                used: false,
                expiresAt: { gt: new Date() }
            },
            orderBy: { createdAt: "desc" }
        });

        if (!verificationRecord) {
            throw new Error("INVALID_VERIFICATION_CODE: Code is invalid, expired, or already used");
        }

        // Update user as verified and active
        const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                isActive: true,
                updatedAt: new Date()
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                isActive: true,
                isVerified: true,
                storeId: true,
                createdAt: true
            }
        });

        // Mark verification code as used
        await tx.verificationCode.update({
            where: { id: verificationRecord.id },
            data: { used: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "ACCOUNT_VERIFIED",
                entityType: "USER",
                entityId: user.id,
                details: { verificationMethod: "CODE" },
                createdAt: new Date()
            }
        });

        return { user: updatedUser };
    });
};

// ============ AUTHENTICATION & SESSIONS ============

/**
 * Authenticate user with email and password
 * Creates new session with access and refresh tokens
 * 
 * @param email User email
 * @param password Plain text password
 * @param userAgent Optional client user agent for logging
 */
export const authenticateUser = async (
    email: string,
    password: string,
    userAgent?: string
): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}> => {
    if (!email || !password) {
        throw new Error("MISSING_REQUIRED_FIELDS: Email and password are required");
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error("INVALID_CREDENTIALS: Invalid email or password");
    }

    // Check if account is active
    if (!user.isActive) {
        throw new Error("ACCOUNT_INACTIVE: Account is not active. Please contact administrator.");
    }

    // Check if account is verified
    if (!user.isVerified) {
        throw new Error("ACCOUNT_UNVERIFIED: Please verify your email address before logging in");
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
        throw new Error("INVALID_CREDENTIALS: Invalid email or password");
    }

    // Generate tokens
    const accessToken = jwt.sign(
        {
            userId: user.id,
            email: user.email,
            role: user.role,
            storeId: user.storeId
        },
        JWT_SECRET,
        { expiresIn: "24h" }
    );

    const refreshToken = crypto.randomBytes(40).toString("hex");
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    // Transaction: Update last login + create refresh token atomically
    await prisma.$transaction(async (tx) => {
        // Update user last login
        await tx.user.update({
            where: { id: user.id },
            data: {
                lastLogin: new Date(),
                updatedAt: new Date()
            }
        });

        // Create refresh token
        await tx.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshTokenHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                revoked: false,
                createdAt: new Date()
            }
        });

        // Log login activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "USER_LOGIN",
                entityType: "USER",
                entityId: user.id,
                details: { userAgent, loginMethod: "PASSWORD" },
                createdAt: new Date()
            }
        });
    });

    // Return user data (excluding sensitive fields)
    const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        storeId: user.storeId,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
    };

    return {
        user: userData,
        accessToken,
        refreshToken,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
    };
};

/**
 * Logout user by revoking refresh token
 * 
 * @param refreshToken Refresh token to revoke
 * @param userId Optional user ID for additional validation
 */
export const logoutUser = async (
    refreshToken: string,
    userId?: string
): Promise<void> => {
    if (!refreshToken) {
        throw new Error("MISSING_REFRESH_TOKEN: Refresh token is required");
    }

    await prisma.$transaction(async (tx) => {
        // Find the refresh token
        const tokens = await tx.refreshToken.findMany({
            where: {
                revoked: false,
                expiresAt: { gt: new Date() },
                ...(userId && { userId })
            }
        });

        // Find matching token by comparing hash
        let tokenToRevoke = null;
        for (const token of tokens) {
            const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
            if (isValid) {
                tokenToRevoke = token;
                break;
            }
        }

        if (!tokenToRevoke) {
            throw new Error("INVALID_REFRESH_TOKEN: Token not found or already revoked");
        }

        // Revoke the token
        await tx.refreshToken.update({
            where: { id: tokenToRevoke.id },
            data: { revoked: true }
        });

        // Log logout activity
        await tx.activityLog.create({
            data: {
                userId: tokenToRevoke.userId,
                action: "USER_LOGOUT",
                entityType: "USER",
                entityId: tokenToRevoke.userId,
                details: { logoutMethod: "TOKEN_REVOCATION" },
                createdAt: new Date()
            }
        });
    });
};

/**
 * Logout user from all sessions
 * Revokes all refresh tokens for a user
 * 
 * @param userId User ID to logout from all devices
 * @param performedBy User ID performing the action (admin/manager)
 */
export const logoutAllSessions = async (
    userId: string,
    performedBy: string
): Promise<{ revokedCount: number }> => {
    // Transaction: Revoke all tokens + log activity
    return await prisma.$transaction(async (tx) => {
        // Revoke all active refresh tokens
        const result = await tx.refreshToken.updateMany({
            where: {
                userId,
                revoked: false,
                expiresAt: { gt: new Date() }
            },
            data: { revoked: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: performedBy,
                action: "LOGOUT_ALL_SESSIONS",
                entityType: "USER",
                entityId: userId,
                details: { tokensRevoked: result.count },
                createdAt: new Date()
            }
        });

        return { revokedCount: result.count };
    });
};

// ============ PASSWORD MANAGEMENT ============

/**
 * Request password reset by email
 * Generates reset token and sends email
 * 
 * @param email User email
 */
export const requestPasswordReset = async (
    email: string
): Promise<{ resetToken: string; expiresAt: Date }> => {
    if (!email) {
        throw new Error("EMAIL_REQUIRED: Email address is required");
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        // For security, don't reveal if user exists
        throw new Error("RESET_REQUEST_RECEIVED: If an account exists, you will receive reset instructions");
    }

    // Check if user is active
    if (!user.isActive) {
        throw new Error("ACCOUNT_INACTIVE: Cannot reset password for inactive account");
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Transaction: Invalidate old tokens + create new one atomically
    await prisma.$transaction(async (tx) => {
        // Invalidate any existing reset tokens
        await tx.passwordReset.updateMany({
            where: {
                userId: user.id,
                used: false,
                expiresAt: { gt: new Date() }
            },
            data: { used: true }
        });

        // Create new reset token
        await tx.passwordReset.create({
            data: {
                userId: user.id,
                tokenHash: resetTokenHash,
                expiresAt,
                used: false,
                createdAt: new Date()
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "PASSWORD_RESET_REQUESTED",
                entityType: "USER",
                entityId: user.id,
                details: { resetMethod: "EMAIL" },
                createdAt: new Date()
            }
        });
    });

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}&email=${email}`;

    await sendEmail(
        email,
        "Password Reset Request",
        `You requested to reset your password. Click the link below to reset:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.`
    );

    return { resetToken, expiresAt };
};

/**
 * Reset password using reset token
 * 
 * @param email User email
 * @param resetToken Password reset token
 * @param newPassword New plain text password
 */
export const resetPassword = async (
    email: string,
    resetToken: string,
    newPassword: string
): Promise<void> => {
    if (!email || !resetToken || !newPassword) {
        throw new Error("MISSING_REQUIRED_FIELDS: Email, reset token, and new password are required");
    }

    // Validate password strength
    if (newPassword.length < 8) {
        throw new Error("WEAK_PASSWORD: Password must be at least 8 characters long");
    }

    // Transaction: Validate token + update password + revoke sessions atomically
    await prisma.$transaction(async (tx) => {
        // Find user
        const user = await tx.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: No user found with this email");
        }

        // Check if user is active
        if (!user.isActive) {
            throw new Error("ACCOUNT_INACTIVE: Cannot reset password for inactive account");
        }

        // Find valid reset token
        const resetRecord = await tx.passwordReset.findFirst({
            where: {
                userId: user.id,
                used: false,
                expiresAt: { gt: new Date() }
            },
            orderBy: { createdAt: "desc" }
        });

        if (!resetRecord) {
            throw new Error("INVALID_RESET_TOKEN: Reset token is invalid or expired");
        }

        // Verify token
        const tokenValid = await bcrypt.compare(resetToken, resetRecord.tokenHash);
        if (!tokenValid) {
            throw new Error("INVALID_RESET_TOKEN: Reset token is invalid");
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Update user password
        await tx.user.update({
            where: { id: user.id },
            data: {
                password: newPasswordHash,
                updatedAt: new Date()
            }
        });

        // Mark reset token as used
        await tx.passwordReset.update({
            where: { id: resetRecord.id },
            data: { used: true }
        });

        // Revoke all refresh tokens for security
        await tx.refreshToken.updateMany({
            where: {
                userId: user.id,
                revoked: false
            },
            data: { revoked: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: user.id,
                action: "PASSWORD_RESET_COMPLETED",
                entityType: "USER",
                entityId: user.id,
                details: { resetMethod: "TOKEN" },
                createdAt: new Date()
            }
        });
    });
};

/**
 * Change password for authenticated user
 * Requires current password for verification
 * 
 * @param userId User ID
 * @param currentPassword Current plain text password
 * @param newPassword New plain text password
 */
export const changePassword = async (
    userId: string,
    currentPassword: string,
    newPassword: string
): Promise<void> => {
    if (!userId || !currentPassword || !newPassword) {
        throw new Error("MISSING_REQUIRED_FIELDS: User ID, current password, and new password are required");
    }

    // Validate new password strength
    if (newPassword.length < 8) {
        throw new Error("WEAK_PASSWORD: New password must be at least 8 characters long");
    }

    // Transaction: Verify + update password + revoke sessions atomically
    await prisma.$transaction(async (tx) => {
        // Get user with password
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: User not found");
        }

        // Check if user is active
        if (!user.isActive) {
            throw new Error("ACCOUNT_INACTIVE: Cannot change password for inactive account");
        }

        // Verify current password
        const currentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!currentPasswordValid) {
            throw new Error("INVALID_CURRENT_PASSWORD: Current password is incorrect");
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Update password
        await tx.user.update({
            where: { id: userId },
            data: {
                password: newPasswordHash,
                updatedAt: new Date()
            }
        });

        // Revoke all refresh tokens for security
        await tx.refreshToken.updateMany({
            where: {
                userId,
                revoked: false
            },
            data: { revoked: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId,
                action: "PASSWORD_CHANGED",
                entityType: "USER",
                entityId: userId,
                details: { changeMethod: "SELF_SERVICE" },
                createdAt: new Date()
            }
        });
    });
};

// ============ ACCOUNT MANAGEMENT ============

/**
 * Get user profile (excluding sensitive data)
 * 
 * @param userId User ID
 */
export const getUserProfile = async (
    userId: string
): Promise<any> => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            isActive: true,
            isVerified: true,
            storeId: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            store: {
                select: {
                    id: true,
                    name: true,
                    location: true
                }
            }
        }
    });

    if (!user) {
        throw new Error("USER_NOT_FOUND: User not found");
    }

    return user;
};

/**
 * Update user profile (non-sensitive fields)
 * 
 * @param userId User ID
 * @param updates Profile updates (firstName, lastName, phone)
 */
export const updateUserProfile = async (
    userId: string,
    updates: {
        firstName?: string;
        lastName?: string;
        phone?: string;
    }
): Promise<any> => {
    // Validate at least one field is being updated
    if (!updates.firstName && !updates.lastName && !updates.phone) {
        throw new Error("NO_UPDATES_PROVIDED: At least one field must be updated");
    }

    // Validate phone format if provided
    if (updates.phone && updates.phone.length < 10) {
        throw new Error("INVALID_PHONE: Phone number must be at least 10 digits");
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
            ...updates,
            updatedAt: new Date()
        },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            isActive: true,
            isVerified: true,
            storeId: true,
            updatedAt: true
        }
    });

    // Log activity
    await prisma.activityLog.create({
        data: {
            userId,
            action: "PROFILE_UPDATED",
            entityType: "USER",
            entityId: userId,
            details: { updatedFields: Object.keys(updates) },
            createdAt: new Date()
        }
    });

    return updatedUser;
};

/**
 * Deactivate user account (soft delete)
 * Prevents login but preserves data
 * 
 * @param userId User ID to deactivate
 * @param performedBy User ID performing deactivation
 * @param reason Optional reason for deactivation
 */
export const deactivateUser = async (
    userId: string,
    performedBy: string,
    reason?: string
): Promise<any> => {
    // Cannot deactivate self
    if (userId === performedBy) {
        throw new Error("CANNOT_DEACTIVATE_SELF: You cannot deactivate your own account");
    }

    // Transaction: Deactivate user + revoke tokens + log activity
    return await prisma.$transaction(async (tx) => {
        // Get user to check role
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: User not found");
        }

        // Check if already deactivated
        if (!user.isActive) {
            throw new Error("ALREADY_DEACTIVATED: User is already deactivated");
        }

        // Deactivate user
        const updatedUser = await tx.user.update({
            where: { id: userId },
            data: {
                isActive: false,
                updatedAt: new Date()
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true
            }
        });

        // Revoke all active refresh tokens
        await tx.refreshToken.updateMany({
            where: {
                userId,
                revoked: false
            },
            data: { revoked: true }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: performedBy,
                action: "USER_DEACTIVATED",
                entityType: "USER",
                entityId: userId,
                details: { reason, deactivatedBy: performedBy },
                createdAt: new Date()
            }
        });

        return updatedUser;
    });
};

/**
 * Reactivate user account
 * 
 * @param userId User ID to reactivate
 * @param performedBy User ID performing reactivation
 * @param reason Optional reason for reactivation
 */
export const reactivateUser = async (
    userId: string,
    performedBy: string,
    reason?: string
): Promise<any> => {
    // Transaction: Reactivate user + log activity
    return await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error("USER_NOT_FOUND: User not found");
        }

        // Check if already active
        if (user.isActive) {
            throw new Error("ALREADY_ACTIVE: User is already active");
        }

        // Reactivate user
        const updatedUser = await tx.user.update({
            where: { id: userId },
            data: {
                isActive: true,
                updatedAt: new Date()
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true
            }
        });

        // Log activity
        await tx.activityLog.create({
            data: {
                userId: performedBy,
                action: "USER_REACTIVATED",
                entityType: "USER",
                entityId: userId,
                details: { reason, reactivatedBy: performedBy },
                createdAt: new Date()
            }
        });

        return updatedUser;
    });
};

// ============ HELPER FUNCTIONS ============

function generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Validate JWT token and return user data
 * Used by middleware for protected routes
 * 
 * @param token JWT access token
 */
export const validateToken = async (
    token: string
): Promise<{ userId: string; email: string; role: Role; storeId?: string }> => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        // Verify user still exists and is active
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, isActive: true, isVerified: true }
        });

        if (!user) {
            throw new Error("USER_NOT_FOUND: User no longer exists");
        }

        if (!user.isActive) {
            throw new Error("ACCOUNT_INACTIVE: Account is deactivated");
        }

        if (!user.isVerified) {
            throw new Error("ACCOUNT_UNVERIFIED: Account is not verified");
        }

        return {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            storeId: decoded.storeId
        };
    } catch (error: any) {
        if (error.name === "TokenExpiredError") {
            throw new Error("TOKEN_EXPIRED: Access token has expired");
        }
        if (error.name === "JsonWebTokenError") {
            throw new Error("INVALID_TOKEN: Invalid access token");
        }
        throw error;
    }
};

// Add these functions to your auth-controller.ts file

/**
 * Get all users with filters and pagination
 * Admin/Manager only
 * 
 * @param filters User filters
 * @param page Page number
 * @param limit Items per page
 */
export const getAllUsers = async (
    filters: {
        role?: string;
        storeId?: string;
        isActive?: boolean;
        search?: string;
    },
    page: number = 1,
    limit: number = 50
): Promise<{
    users: any[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const skip = (page - 1) * limit;

    // Build where condition
    const whereCondition: any = {};

    if (filters.role) {
        whereCondition.role = filters.role as Role;
    }
    if (filters.storeId) {
        whereCondition.storeId = filters.storeId;
    }
    if (filters.isActive !== undefined) {
        whereCondition.isActive = filters.isActive;
    }
    if (filters.search) {
        whereCondition.OR = [
            { firstName: { contains: filters.search, mode: 'insensitive' } },
            { lastName: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } }
        ];
    }

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where: whereCondition,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                isActive: true,
                isVerified: true,
                storeId: true,
                lastLogin: true,
                createdAt: true,
                updatedAt: true,
                store: {
                    select: {
                        id: true,
                        name: true,
                        location: true
                    }
                }
            },
            orderBy: [
                { lastName: 'asc' },
                { firstName: 'asc' }
            ],
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereCondition })
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        users,
        total,
        page,
        totalPages
    };
};

/**
 * Get user by ID with detailed information
 * Admin/Manager only
 * 
 * @param userId User ID
 */
export const getUserById = async (
    userId: string
): Promise<any> => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            isActive: true,
            isVerified: true,
            storeId: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            store: {
                select: {
                    id: true,
                    name: true,
                    location: true,
                    isMainStore: true
                }
            },
            employee: {
                select: {
                    id: true,
                    position: true,
                    role: true
                }
            }
            // Remove the _count section if activityLogs relation doesn't exist
        }
    });

    if (!user) {
        throw new Error("USER_NOT_FOUND: User not found");
    }

    // Get additional statistics separately
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [activityCount, activeSessions, recentActivity] = await Promise.all([
        // Count activity logs
        prisma.activityLog.count({
            where: { userId }
        }),
        // Count active refresh tokens
        prisma.refreshToken.count({
            where: {
                userId,
                revoked: false,
                expiresAt: { gt: new Date() }
            }
        }),
        // Get recent activity
        prisma.activityLog.findMany({
            where: {
                userId,
                createdAt: { gte: thirtyDaysAgo }
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
                action: true,
                entityType: true,
                entityId: true,
                createdAt: true
            }
        })
    ]);

    return {
        ...user,
        statistics: {
            totalActivityLogs: activityCount,
            activeSessions
        },
        recentActivity
    };
};