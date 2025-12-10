// controllers/auth.controller.ts
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../utils/email';
import { BaseController } from './base-controller';
import { AuthRequest } from '../middleware/auth';

export class AuthController extends BaseController {
    // Register new user (Admin only)
    async register(req: Request, res: Response) {
        try {
            const { firstName, lastName, email, password, phoneNumber, role, storeId, position } = req.body;

            // Check if user exists
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Hash password
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);

            // Create user and employee in transaction
            const result = await prisma.$transaction(async (tx: {
                    user: { create: (arg0: { data: { firstName: any; lastName: any; email: any; passwordHash: string; phoneNumber: any; role: any; }; }) => any; }; employee: { create: (arg0: { data: { firstName: any; lastName: any; phone: any; position: any; storeId: any; userId: any; }; }) => any; }; verificationCode: {
                        create: (arg0: {
                            data: {
                                userId: any; code: string; expiresAt: Date; // 24 hours
                            };
                        }) => any;
                    };
                }) => {
                // Create user
                const user = await tx.user.create({
                    data: {
                        firstName,
                        lastName,
                        email,
                        passwordHash,
                        phoneNumber: phoneNumber || '',
                        role: role || 'CASHIER',
                    }
                });

                // Create employee if storeId is provided
                let employee = null;
                if (storeId) {
                    employee = await tx.employee.create({
                        data: {
                            firstName,
                            lastName,
                            phone: phoneNumber || '',
                            position: position || 'Clerk',
                            storeId,
                            userId: user.id
                        }
                    });
                }

                // Create email verification code
                const verificationCode = crypto.randomInt(100000, 999999).toString();
                await tx.verificationCode.create({
                    data: {
                        userId: user.id,
                        code: verificationCode,
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
                    }
                });

                // Send verification email
                await sendEmail({
                    to: email,
                    subject: 'Email Verification',
                    html: `
            <h1>Welcome to Inventory Management System</h1>
            <p>Your verification code is: <strong>${verificationCode}</strong></p>
            <p>This code will expire in 24 hours.</p>
          `
                });

                return { user, employee };
            });

            res.status(201).json({
                message: 'User registered successfully. Please verify your email.',
                userId: result.user.id
            });
        } catch (error) {
            this.handleError(res, error, 'Registration failed');
        }
    }

    // Login
    async login(req: Request, res: Response) {
        try {
            const { email, password } = req.body;

            // Find user
            const user = await prisma.user.findUnique({
                where: { email },
                include: {
                    employee: {
                        include: {
                            store: true
                        }
                    }
                }
            });

            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Check password
            const isValidPassword = await bcrypt.compare(password, user.passwordHash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Check if email is verified (optional based on your requirements)
            if (!user.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
                return res.status(403).json({ error: 'Please verify your email first' });
            }

            // Generate tokens
            const accessToken = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    role: user.role,
                    storeId: user.employee?.storeId
                },
                process.env.JWT_SECRET!,
                { expiresIn: '15m' }
            );

            const refreshToken = crypto.randomBytes(40).toString('hex');
            const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

            // Save refresh token
            await prisma.refreshToken.create({
                data: {
                    userId: user.id,
                    tokenHash: refreshTokenHash,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
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
                    store: user.employee?.store
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Login failed');
        }
    }

    // Refresh token
    async refreshToken(req: Request, res: Response) {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ error: 'Refresh token required' });
            }

            // Find and validate refresh token
            const refreshTokens = await prisma.refreshToken.findMany({
                where: { revoked: false },
                include: { user: true }
            });

            let validToken = null;
            for (const token of refreshTokens) {
                const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
                if (isValid) {
                    validToken = token;
                    break;
                }
            }

            if (!validToken || validToken.expiresAt < new Date()) {
                return res.status(401).json({ error: 'Invalid or expired refresh token' });
            }

            // Revoke old token
            await prisma.refreshToken.update({
                where: { id: validToken.id },
                data: { revoked: true }
            });

            // Generate new tokens
            const user = validToken.user;
            const accessToken = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    role: user.role
                },
                process.env.JWT_SECRET!,
                { expiresIn: '15m' }
            );

            const newRefreshToken = crypto.randomBytes(40).toString('hex');
            const refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);

            // Save new refresh token
            await prisma.refreshToken.create({
                data: {
                    userId: user.id,
                    tokenHash: refreshTokenHash,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    replacedById: validToken.id
                }
            });

            res.json({
                accessToken,
                refreshToken: newRefreshToken
            });
        } catch (error) {
            this.handleError(res, error, 'Token refresh failed');
        }
    }

    // Logout
    async logout(req: Request, res: Response) {
        try {
            const { refreshToken } = req.body;

            if (refreshToken) {
                // Revoke refresh token
                const refreshTokens = await prisma.refreshToken.findMany({
                    where: { revoked: false }
                });

                for (const token of refreshTokens) {
                    const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
                    if (isValid) {
                        await prisma.refreshToken.update({
                            where: { id: token.id },
                            data: { revoked: true }
                        });
                        break;
                    }
                }
            }

            res.json({ message: 'Logged out successfully' });
        } catch (error) {
            this.handleError(res, error, 'Logout failed');
        }
    }

    // Verify email
    async verifyEmail(req: Request, res: Response) {
        try {
            const { email, code } = req.body;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const verificationCode = await prisma.verificationCode.findFirst({
                where: {
                    userId: user.id,
                    code,
                    used: false,
                    expiresAt: { gt: new Date() }
                }
            });

            if (!verificationCode) {
                return res.status(400).json({ error: 'Invalid or expired verification code' });
            }

            // Update verification code and user
            await prisma.$transaction([
                prisma.verificationCode.update({
                    where: { id: verificationCode.id },
                    data: { used: true }
                }),
                prisma.user.update({
                    where: { id: user.id },
                    data: { emailVerified: new Date() }
                })
            ]);

            res.json({ message: 'Email verified successfully' });
        } catch (error) {
            this.handleError(res, error, 'Email verification failed');
        }
    }

    // Forgot password
    async forgotPassword(req: Request, res: Response) {
        try {
            const { email } = req.body;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                // Don't reveal if user exists
                return res.json({ message: 'If an account exists, a reset link will be sent' });
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = await bcrypt.hash(resetToken, 10);

            await prisma.passwordReset.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt: new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour
                }
            });

            const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${email}`;

            await sendEmail({
                to: email,
                subject: 'Password Reset Request',
                html: `
          <h1>Password Reset</h1>
          <p>Click the link below to reset your password:</p>
          <a href="${resetUrl}">Reset Password</a>
          <p>This link will expire in 1 hour.</p>
        `
            });

            res.json({ message: 'Password reset email sent' });
        } catch (error) {
            this.handleError(res, error, 'Password reset request failed');
        }
    }

    // Reset password
    async resetPassword(req: Request, res: Response) {
        try {
            const { email, token, newPassword } = req.body;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Find valid reset token
            const resetRequests = await prisma.passwordReset.findMany({
                where: {
                    userId: user.id,
                    used: false,
                    expiresAt: { gt: new Date() }
                }
            });

            let validRequest = null;
            for (const request of resetRequests) {
                const isValid = await bcrypt.compare(token, request.tokenHash);
                if (isValid) {
                    validRequest = request;
                    break;
                }
            }

            if (!validRequest) {
                return res.status(400).json({ error: 'Invalid or expired reset token' });
            }

            // Hash new password
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(newPassword, salt);

            // Update password and mark token as used
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: user.id },
                    data: { passwordHash }
                }),
                prisma.passwordReset.update({
                    where: { id: validRequest.id },
                    data: { used: true }
                })
            ]);

            res.json({ message: 'Password reset successfully' });
        } catch (error) {
            this.handleError(res, error, 'Password reset failed');
        }
    }

    // Get current user profile
    async getProfile(req: AuthRequest, res: Response) {
        try {
            const user = await this.getUserWithStore(req);

            res.json({
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                phoneNumber: user.phoneNumber,
                emailVerified: user.emailVerified,
                store: user.employee?.store,
                employee: user.employee
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to get profile');
        }
    }

    // Update profile
    async updateProfile(req: AuthRequest, res: Response) {
        try {
            const { firstName, lastName, phoneNumber } = req.body;
            const userId = req.user!.id;

            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: {
                    firstName,
                    lastName,
                    phoneNumber
                },
                include: {
                    employee: {
                        include: {
                            store: true
                        }
                    }
                }
            });

            res.json({
                message: 'Profile updated successfully',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    firstName: updatedUser.firstName,
                    lastName: updatedUser.lastName,
                    role: updatedUser.role,
                    store: updatedUser.employee?.store
                }
            });
        } catch (error) {
            this.handleError(res, error, 'Failed to update profile');
        }
    }
}