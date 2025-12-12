"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshToken = exports.logout = exports.updateProfile = exports.getProfile = exports.resetPassword = exports.requestPasswordReset = exports.forgotPassword = exports.login = exports.verifyEmail = exports.verify = exports.register = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const mail_1 = require("../lib/mail");
const JWT_SECRET = process.env.JWT_SECRET;
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
const register = async (req, res) => {
    try {
        const { email, password, firstName, lastName, phoneNumber, role = 'CASHIER' } = req.body;
        console.log('Registration attempt:', {
            email, firstName, lastName, phoneNumber, role
        });
        if (!email || !password) {
            res.status(400).json({ error: "Email and password are required" });
            return;
        }
        console.log('Checking for existing user...');
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { email }
        });
        if (existingUser) {
            console.log('User already exists:', email);
            res.status(400).json({ error: "User already exists" });
            return;
        }
        console.log('Hashing password...');
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        console.log('Creating user in database...');
        const user = await prisma_1.prisma.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
                firstName,
                lastName,
                phoneNumber,
                role,
                isActive: role !== 'CASHIER',
                emailVerified: role !== 'CASHIER' ? new Date() : null
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
                role: true,
                isActive: true,
                emailVerified: true,
                createdAt: true
            }
        });
        console.log('User created successfully:', user.id);
        res.status(201).json(user);
    }
    catch (error) {
        console.error("=== DETAILED REGISTER ERROR ===");
        console.error("Error type:", error?.constructor?.name);
        console.error("Error message:", error?.message);
        console.error("Error code:", error?.code);
        console.error("Full error:", JSON.stringify(error, null, 2));
        console.error("Error stack:", error?.stack);
        console.error("==============================");
        res.status(500).json({
            error: "Internal server error",
            message: error?.message || "Unknown error",
            code: error?.code,
            ...(process.env.NODE_ENV === 'development' && {
                details: error?.toString()
            })
        });
    }
};
exports.register = register;
const verify = async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            res.status(400).json({ error: "Email and code are required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "Invalid email" });
            return;
        }
        const record = await prisma_1.prisma.verificationCode.findFirst({
            where: { userId: user.id, code, used: false },
            orderBy: { createdAt: "desc" },
        });
        if (!record || record.expiresAt < new Date()) {
            res.status(400).json({ error: "Invalid or expired code" });
            return;
        }
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    isActive: true,
                    emailVerified: new Date()
                }
            }),
            prisma_1.prisma.verificationCode.update({ where: { id: record.id }, data: { used: true } }),
        ]);
        res.json({ message: "User verified successfully" });
    }
    catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.verify = verify;
const verifyEmail = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: "Email is required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "User not found" });
            return;
        }
        if (user.emailVerified) {
            res.status(400).json({ error: "Email is already verified" });
            return;
        }
        const verificationCode = generateCode();
        await prisma_1.prisma.verificationCode.create({
            data: {
                userId: user.id,
                code: verificationCode,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            }
        });
        const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?code=${verificationCode}&email=${email}`;
        await (0, mail_1.sendEmail)(email, "Verify Your Email Address", `Please verify your email by clicking this link: ${verificationUrl}\n\nOr use this verification code: ${verificationCode}`);
        res.json({
            message: "Verification email sent successfully",
            code: verificationCode
        });
    }
    catch (error) {
        console.error("Verify email error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.verifyEmail = verifyEmail;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: "Email and password are required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "Invalid email or password" });
            return;
        }
        if (!user.isActive) {
            res.status(403).json({ error: "Account is not active" });
            return;
        }
        if (!user.passwordHash) {
            res.status(500).json({ error: "User has no password set" });
            return;
        }
        const valid = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!valid) {
            res.status(400).json({ error: "Invalid email or password" });
            return;
        }
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });
        const refreshToken = crypto_1.default.randomBytes(40).toString("hex");
        const refreshHash = await bcrypt_1.default.hash(refreshToken, 10);
        await prisma_1.prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                phoneNumber: user.phoneNumber,
                role: user.role,
                isActive: user.isActive,
                emailVerified: user.emailVerified,
                createdAt: user.createdAt
            }
        });
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.login = login;
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: "Email is required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.json({ message: "If an account exists with this email, a password reset link has been sent" });
            return;
        }
        const token = crypto_1.default.randomBytes(32).toString("hex");
        const tokenHash = await bcrypt_1.default.hash(token, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await prisma_1.prisma.passwordReset.updateMany({
            where: { userId: user.id, used: false },
            data: { used: true }
        });
        await prisma_1.prisma.passwordReset.create({
            data: { userId: user.id, tokenHash, expiresAt },
        });
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;
        await (0, mail_1.sendEmail)(email, "Password Reset Request", `You requested to reset your password. Click the link below to reset:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.`);
        res.json({
            message: "If an account exists with this email, a password reset link has been sent"
        });
    }
    catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.forgotPassword = forgotPassword;
const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: "Email is required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "User not found" });
            return;
        }
        const token = crypto_1.default.randomBytes(32).toString("hex");
        const tokenHash = await bcrypt_1.default.hash(token, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await prisma_1.prisma.passwordReset.create({
            data: { userId: user.id, tokenHash, expiresAt },
        });
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`;
        await (0, mail_1.sendEmail)(email, "Reset your password", `Click here to reset: ${resetUrl}`);
        res.json({ message: "Password reset email sent" });
    }
    catch (error) {
        console.error("Password reset request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.requestPasswordReset = requestPasswordReset;
const resetPassword = async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;
        if (!email || !token || !newPassword) {
            res.status(400).json({ error: "Email, token, and new password are required" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            res.status(400).json({ error: "Invalid email" });
            return;
        }
        const record = await prisma_1.prisma.passwordReset.findFirst({
            where: { userId: user.id, used: false },
            orderBy: { createdAt: "desc" },
        });
        if (!record || record.expiresAt < new Date()) {
            res.status(400).json({ error: "Invalid or expired token" });
            return;
        }
        const isValid = await bcrypt_1.default.compare(token, record.tokenHash);
        if (!isValid) {
            res.status(400).json({ error: "Invalid token" });
            return;
        }
        const newHash = await bcrypt_1.default.hash(newPassword, 12);
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
            prisma_1.prisma.passwordReset.update({ where: { id: record.id }, data: { used: true } }),
        ]);
        await prisma_1.prisma.refreshToken.updateMany({
            where: { userId: user.id, revoked: false },
            data: { revoked: true }
        });
        res.json({ message: "Password updated successfully" });
    }
    catch (error) {
        console.error("Password reset error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.resetPassword = resetPassword;
const getProfile = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
                role: true,
                isActive: true,
                emailVerified: true,
                createdAt: true,
                updatedAt: true
            }
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.json(user);
    }
    catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.getProfile = getProfile;
const updateProfile = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        const { firstName, lastName, phoneNumber, currentPassword, newPassword } = req.body;
        const currentUser = await prisma_1.prisma.user.findUnique({
            where: { id: userId }
        });
        if (!currentUser) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const updateData = {
            firstName,
            lastName,
            phoneNumber,
            updatedAt: new Date()
        };
        if (newPassword) {
            if (!currentPassword) {
                res.status(400).json({ error: "Current password is required to change password" });
                return;
            }
            const valid = await bcrypt_1.default.compare(currentPassword, currentUser.passwordHash);
            if (!valid) {
                res.status(400).json({ error: "Current password is incorrect" });
                return;
            }
            updateData.passwordHash = await bcrypt_1.default.hash(newPassword, 12);
            await prisma_1.prisma.refreshToken.updateMany({
                where: { userId: currentUser.id, revoked: false },
                data: { revoked: true }
            });
        }
        const updatedUser = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phoneNumber: true,
                role: true,
                isActive: true,
                emailVerified: true,
                createdAt: true,
                updatedAt: true
            }
        });
        res.json({
            message: "Profile updated successfully",
            user: updatedUser
        });
    }
    catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.updateProfile = updateProfile;
const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ error: "Refresh token is required" });
            return;
        }
        const tokens = await prisma_1.prisma.refreshToken.findMany({
            where: { revoked: false },
        });
        for (const token of tokens) {
            const isValid = await bcrypt_1.default.compare(refreshToken, token.tokenHash);
            if (isValid) {
                await prisma_1.prisma.refreshToken.update({
                    where: { id: token.id },
                    data: { revoked: true }
                });
                break;
            }
        }
        res.json({ message: "Logged out successfully" });
    }
    catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.logout = logout;
const refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ error: "Refresh token is required" });
            return;
        }
        const tokens = await prisma_1.prisma.refreshToken.findMany({
            where: { revoked: false, expiresAt: { gt: new Date() } },
            include: { user: true }
        });
        let validToken = null;
        for (const token of tokens) {
            const isValid = await bcrypt_1.default.compare(refreshToken, token.tokenHash);
            if (isValid) {
                validToken = token;
                break;
            }
        }
        if (!validToken) {
            res.status(401).json({ error: "Invalid or expired refresh token" });
            return;
        }
        const accessToken = jsonwebtoken_1.default.sign({ userId: validToken.user.id }, JWT_SECRET, { expiresIn: "15m" });
        const newRefreshToken = crypto_1.default.randomBytes(40).toString("hex");
        const refreshHash = await bcrypt_1.default.hash(newRefreshToken, 10);
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.refreshToken.update({
                where: { id: validToken.id },
                data: { revoked: true }
            }),
            prisma_1.prisma.refreshToken.create({
                data: {
                    userId: validToken.user.id,
                    tokenHash: refreshHash,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    replacedById: validToken.id
                }
            })
        ]);
        res.json({
            accessToken,
            refreshToken: newRefreshToken
        });
    }
    catch (error) {
        console.error("Refresh token error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.refreshToken = refreshToken;
//# sourceMappingURL=auth-controller.js.map