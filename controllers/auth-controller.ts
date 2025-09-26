import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../lib/mail";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

interface AuthRequest extends Request {
    body: {
        email: string;
        password?: string;
        name?: string;
        role?: string;
        code?: string;
        token?: string;
        newPassword?: string;
    };
}

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// REGISTER
export const register = async (req: AuthRequest, res: Response) => {
    try {
        const { email, password, name, role } = req.body;

        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(400).json({ error: "User already exists" });

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: { email, role: role as any, passwordHash },
        });

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.verificationCode.create({
            data: { userId: user.id, code, expiresAt },
        });

        await sendEmail(email, "Your verification code", `Your code is: ${code}`);

        res.status(201).json({ message: "User registered. Check email for verification code." });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// VERIFY EMAIL
export const verify = async (req: AuthRequest, res: Response) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: "Email and code are required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(400).json({ error: "Invalid email" });

        const record = await prisma.verificationCode.findFirst({
            where: { userId: user.id, code, used: false },
            orderBy: { createdAt: "desc" },
        });

        if (!record || record.expiresAt < new Date()) return res.status(400).json({ error: "Invalid or expired code" });

        await prisma.$transaction([
            prisma.user.update({ where: { id: user.id }, data: { isVerified: true } }),
            prisma.verificationCode.update({ where: { id: record.id }, data: { used: true } }),
        ]);

        res.json({ message: "User verified successfully" });
    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// LOGIN
export const login = async (req: AuthRequest, res: Response) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(400).json({ error: "Invalid email or password" });
        if (!user.isVerified) return res.status(403).json({ error: "Account not verified" });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ error: "Invalid email or password" });

        const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });
        const refreshToken = crypto.randomBytes(40).toString("hex");
        const refreshHash = await bcrypt.hash(refreshToken, 10);

        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });

        res.json({
            accessToken,
            refreshToken,
            user: { id: user.id, email: user.email,},
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// REQUEST PASSWORD RESET
export const requestPasswordReset = async (req: AuthRequest, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.json({ message: "If the email exists, a reset link was sent." });

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = await bcrypt.hash(token, 10);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.passwordReset.create({
            data: { userId: user.id, tokenHash, expiresAt },
        });

        const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${token}&email=${email}`;
        await sendEmail(email, "Reset your password", `Click here: ${resetUrl}`);

        res.json({ message: "Password reset email sent" });
    } catch (error) {
        console.error("Password reset request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// RESET PASSWORD
export const resetPassword = async (req: AuthRequest, res: Response) => {
    try {
        const { email, token, newPassword } = req.body;
        if (!email || !token || !newPassword) return res.status(400).json({ error: "Email, token, and new password are required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(400).json({ error: "Invalid email" });

        const record = await prisma.passwordReset.findFirst({
            where: { userId: user.id, used: false },
            orderBy: { createdAt: "desc" },
        });

        if (!record || record.expiresAt < new Date()) return res.status(400).json({ error: "Invalid or expired token" });

        const isValid = await bcrypt.compare(token, record.tokenHash);
        if (!isValid) return res.status(400).json({ error: "Invalid token" });

        const newHash = await bcrypt.hash(newPassword, 12);

        await prisma.$transaction([
            prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
            prisma.passwordReset.update({ where: { id: record.id }, data: { used: true } }),
        ]);

        res.json({ message: "Password updated successfully" });
    } catch (error) {
        console.error("Password reset error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
