// import bcrypt from "bcrypt";
// import jwt from "jsonwebtoken";
// import crypto from "crypto";
// import { Request, Response } from "express";
// import { prisma } from "../../lib/prisma";
// import { sendEmail } from "../../lib/mail";
// import { Role } from "@prisma/client";

// const JWT_SECRET = process.env.JWT_SECRET as string;

// if (!JWT_SECRET) {
//     throw new Error('JWT_SECRET is not defined in environment variables');
// }

// interface AuthRequest extends Request {
//     body: {
//         email: string;
//         password: string;
//         firstName?: string;
//         lastName?: string;
//         phoneNumber?: string;
//         role: Role;
//         code?: string;
//         token?: string;
//         newPassword?: string;
//         refreshToken?: string;
//         currentPassword?: string;
//     };
//     user?: any;
// }


// interface ProfileUpdateRequest extends Request {
//     body: {
//         firstName?: string;
//         lastName?: string;
//         phoneNumber?: string;
//         currentPassword?: string;
//         newPassword?: string;
//     }
// }

// function generateCode(): string {
//     return Math.floor(100000 + Math.random() * 900000).toString();
// }

// export const register = async (req: Request, res: Response): Promise<void> => {
//     try {
//         const { email, password, firstName, lastName, phoneNumber, role = 'CASHIER' } = req.body;

//         console.log('Registration attempt:', {
//             email, firstName, lastName, phoneNumber, role
//         });

//         // Validate input
//         if (!email || !password) {
//             res.status(400).json({ error: "Email and password are required" });
//             return;
//         }

//         console.log('Checking for existing user...');

//         // Check if user already exists
//         const existingUser = await prisma.user.findUnique({
//             where: { email }
//         });

//         if (existingUser) {
//             console.log('User already exists:', email);
//             res.status(400).json({ error: "User already exists" });
//             return;
//         }

//         console.log('Hashing password...');

//         // Hash password
//         const hashedPassword = await bcrypt.hash(password, 12);

//         console.log('Creating user in database...');

//         // Create user
//         const user = await prisma.user.create({
//             data: {
//                 email,
//                 passwordHash: hashedPassword,
//                 firstName,
//                 lastName,
//                 phoneNumber,
//                 role,
//                 isActive: role !== 'CASHIER',
//                 emailVerified: role !== 'CASHIER' ? new Date() : null
//             },
//             select: {
//                 id: true,
//                 email: true,
//                 firstName: true,
//                 lastName: true,
//                 phoneNumber: true,
//                 role: true,
//                 isActive: true,
//                 emailVerified: true,
//                 createdAt: true
//             }
//         });

//         console.log('User created successfully:', user.id);
//         res.status(201).json(user);
//     } catch (error: any) {
//         console.error("=== DETAILED REGISTER ERROR ===");
//         console.error("Error type:", error?.constructor?.name);
//         console.error("Error message:", error?.message);
//         console.error("Error code:", error?.code);
//         console.error("Full error:", JSON.stringify(error, null, 2));
//         console.error("Error stack:", error?.stack);
//         console.error("==============================");

//         res.status(500).json({
//             error: "Internal server error",
//             message: error?.message || "Unknown error",
//             code: error?.code,
//             ...(process.env.NODE_ENV === 'development' && {
//                 details: error?.toString()
//             })
//         });
//     }
// };

// // Existing verify function...
// export const verify = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email, code } = req.body;

//         if (!email || !code) {
//             res.status(400).json({ error: "Email and code are required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             res.status(400).json({ error: "Invalid email" });
//             return;
//         }

//         const record = await prisma.verificationCode.findFirst({
//             where: { userId: user.id, code, used: false },
//             orderBy: { createdAt: "desc" },
//         });

//         if (!record || record.expiresAt < new Date()) {
//             res.status(400).json({ error: "Invalid or expired code" });
//             return;
//         }

//         await prisma.$transaction([
//             prisma.user.update({
//                 where: { id: user.id },
//                 data: {
//                     isActive: true,
//                     emailVerified: new Date()
//                 }
//             }),
//             prisma.verificationCode.update({ where: { id: record.id }, data: { used: true } }),
//         ]);

//         res.json({ message: "User verified successfully" });
//     } catch (error) {
//         console.error("Verification error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };

// // NEW: Verify Email (send verification email)
// export const verifyEmail = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email } = req.body;

//         if (!email) {
//             res.status(400).json({ error: "Email is required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             res.status(400).json({ error: "User not found" });
//             return;
//         }

//         if (user.emailVerified) {
//             res.status(400).json({ error: "Email is already verified" });
//             return;
//         }

//         // Generate verification code
//         const verificationCode = generateCode();

//         // Save verification code
//         await prisma.verificationCode.create({
//             data: {
//                 userId: user.id,
//                 code: verificationCode,
//                 expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
//             }
//         });

//         // Send verification email
//         const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?code=${verificationCode}&email=${email}`;

//         await sendEmail(
//             email,
//             "Verify Your Email Address",
//             `Please verify your email by clicking this link: ${verificationUrl}\n\nOr use this verification code: ${verificationCode}`
//         );

//         res.json({
//             message: "Verification email sent successfully",
//             code: verificationCode // For testing purposes only
//         });
//     } catch (error) {
//         console.error("Verify email error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };


// export const login = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email, password } = req.body;

//         console.log('Login attempt for:', email);

//         if (!email || !password) {
//             res.status(400).json({ error: "Email and password are required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             res.status(400).json({ error: "Invalid email or password" });
//             return;
//         }

//         if (!user.isActive) {
//             res.status(403).json({ error: "Account is not active" });
//             return;
//         }

//         if (!user.passwordHash) {
//             res.status(500).json({ error: "User has no password set" });
//             return;
//         }

//         const valid = await bcrypt.compare(password, user.passwordHash);
//         if (!valid) {
//             res.status(400).json({ error: "Invalid email or password" });
//             return;
//         }

//         // Generate access token
//         const accessToken = jwt.sign(
//             { userId: user.id, email: user.email, role: user.role },
//             JWT_SECRET,
//             { expiresIn: "24h" }
//         );

//         // Generate refresh token
//         const refreshToken = crypto.randomBytes(40).toString("hex");
//         const refreshHash = await bcrypt.hash(refreshToken, 10);

//         await prisma.refreshToken.create({
//             data: {
//                 userId: user.id,
//                 tokenHash: refreshHash,
//                 expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
//             },
//         });

//         console.log('Login successful, setting cookies...');

//         // Set cookies with proper configuration
//         res.cookie('accessToken', accessToken, {
//             httpOnly: true,
//             secure: process.env.NODE_ENV === 'production',
//             sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
//             maxAge: 24 * 60 * 60 * 1000, // 24 hours
//             path: '/',
//         });

//         res.cookie('refreshToken', refreshToken, {
//             httpOnly: true,
//             secure: process.env.NODE_ENV === 'production',
//             sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
//             maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//             path: '/',
//         });

//         console.log('Cookies set, sending response');

//         // Return user data without tokens
//         res.json({
//             user: {
//                 id: user.id,
//                 email: user.email,
//                 firstName: user.firstName,
//                 lastName: user.lastName,
//                 phoneNumber: user.phoneNumber,
//                 role: user.role,
//                 isActive: user.isActive,
//                 emailVerified: user.emailVerified,
//                 createdAt: user.createdAt
//             }
//         });
//     } catch (error) {
//         console.error("Login error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };

// export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         console.log('Getting profile, cookies:', req.cookies);
//         console.log('Authorization header:', req.headers.authorization);

//         // Get token from cookie (or header as fallback)
//         const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');

//         console.log('Token found:', !!token);

//         if (!token) {
//             res.status(401).json({ error: "Unauthorized - No token provided" });
//             return;
//         }

//         // Verify token
//         let decoded;
//         try {
//             decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
//             console.log('Token verified for user:', decoded.userId);
//         } catch (jwtError) {
//             console.error('JWT verification failed:', jwtError);
//             res.status(401).json({ error: "Invalid token" });
//             return;
//         }

//         const user = await prisma.user.findUnique({
//             where: { id: decoded.userId },
//             select: {
//                 id: true,
//                 email: true,
//                 firstName: true,
//                 lastName: true,
//                 phoneNumber: true,
//                 role: true,
//                 isActive: true,
//                 emailVerified: true,
//                 createdAt: true,
//                 updatedAt: true
//             }
//         });

//         if (!user) {
//             res.status(404).json({ error: "User not found" });
//             return;
//         }

//         console.log('Profile retrieved successfully for:', user.email);
//         res.json(user);
//     } catch (error) {
//         console.error("Get profile error:", error);
//         res.status(401).json({ error: "Invalid token" });
//     }
// };

// export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

//         if (refreshToken) {
//             // Find and revoke the refresh token
//             const tokens = await prisma.refreshToken.findMany({
//                 where: { revoked: false },
//             });

//             for (const token of tokens) {
//                 const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
//                 if (isValid) {
//                     await prisma.refreshToken.update({
//                         where: { id: token.id },
//                         data: { revoked: true }
//                     });
//                     break;
//                 }
//             }
//         }

//         // Clear cookies
//         res.clearCookie('accessToken', { path: '/' });
//         res.clearCookie('refreshToken', { path: '/' });

//         res.json({ message: "Logged out successfully" });
//     } catch (error) {
//         console.error("Logout error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };


// export const forgotPassword = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email } = req.body;

//         if (!email) {
//             res.status(400).json({ error: "Email is required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             // For security, don't reveal if user exists or not
//             res.json({ message: "If an account exists with this email, a password reset link has been sent" });
//             return;
//         }

//         const token = crypto.randomBytes(32).toString("hex");
//         const tokenHash = await bcrypt.hash(token, 10);
//         const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

//         // Invalidate any existing reset tokens for this user
//         await prisma.passwordReset.updateMany({
//             where: { userId: user.id, used: false },
//             data: { used: true }
//         });

//         // Create new reset token
//         await prisma.passwordReset.create({
//             data: { userId: user.id, tokenHash, expiresAt },
//         });

//         const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;

//         await sendEmail(
//             email,
//             "Password Reset Request",
//             `You requested to reset your password. Click the link below to reset:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.`
//         );

//         res.json({
//             message: "If an account exists with this email, a password reset link has been sent"
//         });
//     } catch (error) {
//         console.error("Forgot password error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };

// // Existing requestPasswordReset function...
// export const requestPasswordReset = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email } = req.body;

//         if (!email) {
//             res.status(400).json({ error: "Email is required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             res.status(400).json({ error: "User not found" });
//             return;
//         }

//         const token = crypto.randomBytes(32).toString("hex");
//         const tokenHash = await bcrypt.hash(token, 10);
//         const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

//         await prisma.passwordReset.create({
//             data: { userId: user.id, tokenHash, expiresAt },
//         });

//         const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;

//         await sendEmail(email, "Reset your password", `Click here to reset: ${resetUrl}`);

//         res.json({ message: "Password reset email sent" });
//     } catch (error) {
//         console.error("Password reset request error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };

// // Existing resetPassword function...
// export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { email, token, newPassword } = req.body;

//         if (!email || !token || !newPassword) {
//             res.status(400).json({ error: "Email, token, and new password are required" });
//             return;
//         }

//         const user = await prisma.user.findUnique({ where: { email } });
//         if (!user) {
//             res.status(400).json({ error: "Invalid email" });
//             return;
//         }

//         const record = await prisma.passwordReset.findFirst({
//             where: { userId: user.id, used: false },
//             orderBy: { createdAt: "desc" },
//         });

//         if (!record || record.expiresAt < new Date()) {
//             res.status(400).json({ error: "Invalid or expired token" });
//             return;
//         }

//         const isValid = await bcrypt.compare(token, record.tokenHash);
//         if (!isValid) {
//             res.status(400).json({ error: "Invalid token" });
//             return;
//         }

//         const newHash = await bcrypt.hash(newPassword, 12);

//         await prisma.$transaction([
//             prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
//             prisma.passwordReset.update({ where: { id: record.id }, data: { used: true } }),
//         ]);

//         // Invalidate all refresh tokens for security
//         await prisma.refreshToken.updateMany({
//             where: { userId: user.id, revoked: false },
//             data: { revoked: true }
//         });

//         res.json({ message: "Password updated successfully" });
//     } catch (error) {
//         console.error("Password reset error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };



// // NEW: Update User Profile
// export const updateProfile = async (req: ProfileUpdateRequest, res: Response): Promise<void> => {
//     try {
//         // Get user ID from JWT token
//         const userId = (req as any).userId;

//         if (!userId) {
//             res.status(401).json({ error: "Unauthorized" });
//             return;
//         }

//         const { firstName, lastName, phoneNumber, currentPassword, newPassword } = req.body;

//         // Get current user to verify password if changing password
//         const currentUser = await prisma.user.findUnique({
//             where: { id: userId }
//         });

//         if (!currentUser) {
//             res.status(404).json({ error: "User not found" });
//             return;
//         }

//         // Prepare update data
//         const updateData: any = {
//             firstName,
//             lastName,
//             phoneNumber,
//             updatedAt: new Date()
//         };

//         // Handle password change if requested
//         if (newPassword) {
//             if (!currentPassword) {
//                 res.status(400).json({ error: "Current password is required to change password" });
//                 return;
//             }

//             // Verify current password
//             const valid = await bcrypt.compare(currentPassword, currentUser.passwordHash);
//             if (!valid) {
//                 res.status(400).json({ error: "Current password is incorrect" });
//                 return;
//             }

//             // Hash new password
//             updateData.passwordHash = await bcrypt.hash(newPassword, 12);

//             // Invalidate all refresh tokens when password changes
//             await prisma.refreshToken.updateMany({
//                 where: { userId: currentUser.id, revoked: false },
//                 data: { revoked: true }
//             });
//         }

//         // Update user
//         const updatedUser = await prisma.user.update({
//             where: { id: userId },
//             data: updateData,
//             select: {
//                 id: true,
//                 email: true,
//                 firstName: true,
//                 lastName: true,
//                 phoneNumber: true,
//                 role: true,
//                 isActive: true,
//                 emailVerified: true,
//                 createdAt: true,
//                 updatedAt: true
//             }
//         });

//         res.json({
//             message: "Profile updated successfully",
//             user: updatedUser
//         });
//     } catch (error) {
//         console.error("Update profile error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };



// // Existing refreshToken function...
// export const refreshToken = async (req: AuthRequest, res: Response): Promise<void> => {
//     try {
//         const { refreshToken } = req.body;

//         if (!refreshToken) {
//             res.status(400).json({ error: "Refresh token is required" });
//             return;
//         }

//         // Find the refresh token
//         const tokens = await prisma.refreshToken.findMany({
//             where: { revoked: false, expiresAt: { gt: new Date() } },
//             include: { user: true }
//         });

//         let validToken = null;
//         for (const token of tokens) {
//             const isValid = await bcrypt.compare(refreshToken, token.tokenHash);
//             if (isValid) {
//                 validToken = token;
//                 break;
//             }
//         }

//         if (!validToken) {
//             res.status(401).json({ error: "Invalid or expired refresh token" });
//             return;
//         }

//         // Generate new access token
//         const accessToken = jwt.sign({ userId: validToken.user.id }, JWT_SECRET, { expiresIn: "15m" });

//         // Generate new refresh token
//         const newRefreshToken = crypto.randomBytes(40).toString("hex");
//         const refreshHash = await bcrypt.hash(newRefreshToken, 10);

//         // Revoke old token and create new one
//         await prisma.$transaction([
//             prisma.refreshToken.update({
//                 where: { id: validToken.id },
//                 data: { revoked: true }
//             }),
//             prisma.refreshToken.create({
//                 data: {
//                     userId: validToken.user.id,
//                     tokenHash: refreshHash,
//                     expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
//                     replacedById: validToken.id
//                 }
//             })
//         ]);

//         res.json({
//             accessToken,
//             refreshToken: newRefreshToken
//         });
//     } catch (error) {
//         console.error("Refresh token error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// };