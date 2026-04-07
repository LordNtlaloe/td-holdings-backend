// controllers/auth-controller.ts
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../lib/mail";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta } from "../helpers";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

interface AuthRequest extends Request {
    body: {
        email: string;
        password: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        role?: string;
        storeId?: string;
        code?: string;
        token?: string;
        refreshToken?: string;
        newPassword?: string;
    }
}

// Define custom type for user in request
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
}

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export const register = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { email, password, firstName, lastName, phone, role = 'CASHIER', storeId } = req.body;

        console.log('Registration attempt:', { email, firstName, role, storeId });

        // Validate input
        if (!email || !password || !firstName || !lastName) {
            res.status(400).json({ error: "Email, password, first name and last name are required" });
            return;
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            console.log('User already exists:', email);
            res.status(400).json({ error: "User already exists" });
            return;
        }

        // Validate store if provided
        if (storeId) {
            const store = await prisma.store.findUnique({ where: { id: storeId } });
            if (!store) {
                res.status(400).json({ error: "Invalid store ID" });
                return;
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName,
                lastName,
                phone: phone || '',
                role: role as any,
                storeId,
                isVerified: role !== 'CASHIER' // Auto-verify non-cashier users
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isVerified: true,
                isActive: true,
                storeId: true,
                createdAt: true
            }
        });

        console.log('User created successfully:', user.id);
        res.status(201).json(user);
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const verify = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            res.status(400).json({ error: "Email and code are required" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "Invalid email" });
            return;
        }

        const record = await prisma.verificationCode.findFirst({
            where: { userId: user.id, code, used: false },
            orderBy: { createdAt: "desc" },
        });

        if (!record || record.expiresAt < new Date()) {
            res.status(400).json({ error: "Invalid or expired code" });
            return;
        }

        await prisma.$transaction([
            prisma.user.update({ where: { id: user.id }, data: { isVerified: true } }),
            prisma.verificationCode.update({ where: { id: record.id }, data: { used: true } }),
        ]);

        // Create activity log
        await prisma.activityLog.create({
            data: {
                userId: user.id,
                action: 'ACCOUNT_VERIFIED',
                entityType: 'USER',
                entityId: user.id,
                details: { method: 'CODE_VERIFICATION' }
            }
        });

        res.json({ message: "User verified successfully" });
    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;

        console.log('Login attempt for:', email);

        if (!email || !password) {
            res.status(400).json({ error: "Email and password are required" });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { email },
            include: { employee: true }
        });

        if (!user) {
            console.log('User not found:', email);
            res.status(400).json({ error: "Invalid email or password" });
            return;
        }

        if (!user.isVerified) {
            console.log('User not verified:', email);
            res.status(403).json({ error: "Account not verified" });
            return;
        }

        if (!user.isActive) {
            console.log('User inactive:', email);
            res.status(403).json({ error: "Account is deactivated" });
            return;
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            console.log('Invalid password for:', email);
            res.status(400).json({ error: "Invalid email or password" });
            return;
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Generate short-lived access token (15 minutes)
        const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });

        // Generate long-lived refresh token (30 days)
        const refreshToken = crypto.randomBytes(40).toString("hex");
        const refreshHash = await bcrypt.hash(refreshToken, 10);

        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshHash,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            },
        });

        console.log('Login successful for:', email);
        console.log('Access token expires in: 15 minutes');
        console.log('Refresh token expires in: 30 days');

        // Create activity log
        await prisma.activityLog.create({
            data: {
                userId: user.id,
                action: 'LOGIN',
                entityType: 'USER',
                entityId: user.id,
                details: { loginTime: new Date() }
            }
        });

        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                isVerified: user.isVerified,
                isActive: user.isActive,
                storeId: user.storeId,
                employeeId: user.employee?.id,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            // Find and revoke the refresh token
            const tokens = await prisma.refreshToken.findMany({
                where: {
                    revoked: false,
                    expiresAt: { gt: new Date() }
                }
            });

            for (const storedToken of tokens) {
                const isMatch = await bcrypt.compare(refreshToken, storedToken.tokenHash);
                if (isMatch) {
                    await prisma.refreshToken.update({
                        where: { id: storedToken.id },
                        data: { revoked: true }
                    });
                    break;
                }
            }
        }

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'LOGOUT',
                    entityType: 'USER',
                    entityId: req.user.id,
                    details: { logoutTime: new Date() }
                }
            });
        }

        res.json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const logoutAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;

        // Revoke all refresh tokens for this user
        await prisma.refreshToken.updateMany({
            where: {
                userId: userId,
                revoked: false
            },
            data: { revoked: true }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'LOGOUT_ALL',
                    entityType: 'USER',
                    entityId: userId,
                    details: { logoutAllTime: new Date() }
                }
            });
        }

        res.json({ message: "All sessions logged out successfully" });
    } catch (error) {
        console.error("Logout all error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const requestPasswordReset = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { email } = req.body;

        if (!email) {
            res.status(400).json({ error: "Email is required" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "User not found" });
            return;
        }

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = await bcrypt.hash(token, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.passwordReset.create({
            data: { userId: user.id, tokenHash, expiresAt },
        });

        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;

        await sendEmail(email, "Reset your password", `Click here to reset: ${resetUrl}`);

        // Create activity log
        await prisma.activityLog.create({
            data: {
                userId: user.id,
                action: 'PASSWORD_RESET_REQUESTED',
                entityType: 'USER',
                entityId: user.id,
                details: { requestTime: new Date() }
            }
        });

        res.json({ message: "Password reset email sent" });
    } catch (error) {
        console.error("Password reset request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            res.status(400).json({ error: "Email, token, and new password are required" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "Invalid email" });
            return;
        }

        const record = await prisma.passwordReset.findFirst({
            where: { userId: user.id, used: false },
            orderBy: { createdAt: "desc" },
        });

        if (!record || record.expiresAt < new Date()) {
            res.status(400).json({ error: "Invalid or expired token" });
            return;
        }

        const isValid = await bcrypt.compare(token, record.tokenHash);
        if (!isValid) {
            res.status(400).json({ error: "Invalid token" });
            return;
        }

        const newHash = await bcrypt.hash(newPassword, 12);

        await prisma.$transaction([
            prisma.user.update({ where: { id: user.id }, data: { password: newHash } }),
            prisma.passwordReset.update({ where: { id: record.id }, data: { used: true } }),
        ]);

        // Create activity log
        await prisma.activityLog.create({
            data: {
                userId: user.id,
                action: 'PASSWORD_RESET_COMPLETED',
                entityType: 'USER',
                entityId: user.id,
                details: { resetTime: new Date() }
            }
        });

        res.json({ message: "Password updated successfully" });
    } catch (error) {
        console.error("Password reset error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const refreshToken = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { refreshToken } = req.body;

        console.log('Refresh token attempt');

        if (!refreshToken) {
            res.status(400).json({ error: "Refresh token required" });
            return;
        }

        // Find all non-revoked, non-expired tokens for comparison
        const validTokens = await prisma.refreshToken.findMany({
            where: {
                revoked: false,
                expiresAt: { gt: new Date() }
            },
            include: { user: true }
        });

        console.log(`Found ${validTokens.length} valid tokens to check`);

        // Compare the provided token with each stored hash
        let matchedToken = null;
        for (const storedToken of validTokens) {
            const isMatch = await bcrypt.compare(refreshToken, storedToken.tokenHash);
            if (isMatch) {
                matchedToken = storedToken;
                console.log('Refresh token matched!');
                break;
            }
        }

        if (!matchedToken) {
            console.log('No matching refresh token found');
            res.status(401).json({ error: "Invalid refresh token" });
            return;
        }

        // Revoke old token
        await prisma.refreshToken.update({
            where: { id: matchedToken.id },
            data: { revoked: true }
        });

        // Generate new access token (15 minutes)
        const newAccessToken = jwt.sign({ userId: matchedToken.userId }, JWT_SECRET, { expiresIn: "15m" });

        // Generate new refresh token (30 days)
        const newRefreshToken = crypto.randomBytes(40).toString("hex");
        const newRefreshHash = await bcrypt.hash(newRefreshToken, 10);

        // Create new refresh token
        await prisma.refreshToken.create({
            data: {
                userId: matchedToken.userId,
                tokenHash: newRefreshHash,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            },
        });

        console.log('Tokens refreshed successfully');

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: {
                id: matchedToken.user.id,
                email: matchedToken.user.email,
                firstName: matchedToken.user.firstName,
                lastName: matchedToken.user.lastName,
                role: matchedToken.user.role,
                isVerified: matchedToken.user.isVerified,
                isActive: matchedToken.user.isActive,
                storeId: matchedToken.user.storeId,
                createdAt: matchedToken.user.createdAt
            }
        });
    } catch (error) {
        console.error("Refresh token error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        const { page = 1, limit = 10, sortBy, sortOrder, search, role, storeId, isActive } = req.query;
        const { skip, take } = generatePagination(Number(page), Number(limit));

        const filterBuilder = new FilterBuilder()
            .where(search as string, ['email', 'firstName', 'lastName'])
            .status(role as string, 'role')
            .status(isActive as string, 'isActive')
            .store(storeId as string)
            .order(sortBy as string, sortOrder as 'asc' | 'desc');

        const filters = filterBuilder.build();

        const whereClause = filters.where || {};
        const orderByClause = filters.orderBy || { createdAt: 'desc' };

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                skip,
                take,
                orderBy: orderByClause,
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isVerified: true,
                    isActive: true,
                    storeId: true,
                    lastLogin: true,
                    createdAt: true,
                    store: {
                        select: { name: true }
                    },
                    employee: {
                        select: { id: true, position: true, status: true }
                    }
                }
            }),
            prisma.user.count({ where: whereClause })
        ]);

        res.json({
            data: users,
            meta: generateMeta(total, Number(page), Number(limit))
        });
    } catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                store: true,
                employee: true,
                activities: {
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            }
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        res.json(user);
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const updateUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;
        const { firstName, lastName, phone, role, storeId, isActive } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                ...(firstName && { firstName }),
                ...(lastName && { lastName }),
                ...(phone && { phone }),
                ...(role && { role: role as any }),
                ...(storeId && { storeId }),
                ...(isActive !== undefined && { isActive })
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isVerified: true,
                isActive: true,
                storeId: true,
                createdAt: true
            }
        });

        // Create activity log
        if (req.user?.id) {
            await prisma.activityLog.create({
                data: {
                    userId: req.user.id,
                    action: 'USER_UPDATED',
                    entityType: 'USER',
                    entityId: userId,
                    details: { updatedFields: Object.keys(req.body) }
                }
            });
        }

        res.json(updatedUser);
    } catch (error) {
        console.error("Update user error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            res.status(400).json({ error: "Current and new password required" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        // Verify current password
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) {
            res.status(400).json({ error: "Current password is incorrect" });
            return;
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPassword, 12);

        await prisma.user.update({
            where: { id: userId },
            data: { password: newHash }
        });

        // Create activity log
        await prisma.activityLog.create({
            data: {
                userId: userId,
                action: 'PASSWORD_CHANGED',
                entityType: 'USER',
                entityId: userId,
                details: { changeTime: new Date() }
            }
        });

        res.json({ message: "Password changed successfully" });
    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;

        if (req.user?.id !== userId && req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Unauthorized to view these sessions" });
            return;
        }

        const sessions = await prisma.refreshToken.findMany({
            where: { userId: userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                createdAt: true,
                expiresAt: true,
                revoked: true
            }
        });

        res.json({ sessions });
    } catch (error) {
        console.error("Get sessions error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const revokeSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id, tokenId } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;
        const sessionId = Array.isArray(tokenId) ? tokenId[0] : tokenId;

        if (req.user?.id !== userId && req.user?.role !== 'ADMIN') {
            res.status(403).json({ error: "Unauthorized to revoke this session" });
            return;
        }

        await prisma.refreshToken.update({
            where: { id: sessionId },
            data: { revoked: true }
        });

        res.json({ message: "Session revoked successfully" });
    } catch (error) {
        console.error("Revoke session error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};