"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const sendEmail = async (to, subject, text, html) => {
    try {
        const mailOptions = {
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to,
            subject,
            text,
            html: html || `<p>${text}</p>`,
        };
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
    }
    catch (error) {
        console.error('Email error:', error);
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
    }
};
exports.sendEmail = sendEmail;
//# sourceMappingURL=mail.js.map