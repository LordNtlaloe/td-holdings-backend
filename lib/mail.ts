import nodemailer from 'nodemailer';

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

export const sendEmail = async (
    to: string,
    subject: string,
    text: string,
    html?: string
): Promise<void> => {
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
    } catch (error) {
        console.error('Email error:', error);
        // In development, don't throw - just log
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
    }
};