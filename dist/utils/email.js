"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = exports.formatCurrency = exports.sendEmail = exports.emailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const handlebars_1 = __importDefault(require("handlebars"));
const util_1 = require("util");
const readFile = (0, util_1.promisify)(fs_1.default.readFile);
const emailTemplates = {
    verification: {
        subject: 'Verify Your Email - Inventory Management System',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .code { font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 5px; text-align: center; margin: 20px 0; }
          .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email</h1>
          </div>
          <div class="content">
            <h2>Hello {{name}},</h2>
            <p>Thank you for registering with our Inventory Management System. To complete your registration, please verify your email address by using the verification code below:</p>
            
            <div class="code">{{code}}</div>
            
            <p>This code will expire in 24 hours.</p>
            
            <p>If you didn't create an account with us, please ignore this email.</p>
            
            <p>Best regards,<br>Inventory Management Team</p>
          </div>
          <div class="footer">
            <p>This email was sent by Inventory Management System</p>
            <p>© {{year}} Inventory Management System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `Hello {{name}},\n\nThank you for registering with our Inventory Management System. To complete your registration, please verify your email address by using the verification code below:\n\n{{code}}\n\nThis code will expire in 24 hours.\n\nIf you didn't create an account with us, please ignore this email.\n\nBest regards,\nInventory Management Team`
    },
    passwordReset: {
        subject: 'Password Reset Request - Inventory Management System',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #DC2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
          .token { background: #f0f0f0; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <h2>Hello {{name}},</h2>
            <p>We received a request to reset your password for your Inventory Management System account.</p>
            
            <p>Click the button below to reset your password:</p>
            
            <a href="{{resetUrl}}" class="button">Reset Password</a>
            
            <p>Or copy and paste this link into your browser:</p>
            <div class="token">{{resetUrl}}</div>
            
            <p>This link will expire in 1 hour.</p>
            
            <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
            
            <p>Best regards,<br>Inventory Management Team</p>
          </div>
          <div class="footer">
            <p>This email was sent by Inventory Management System</p>
            <p>© {{year}} Inventory Management System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `Hello {{name}},\n\nWe received a request to reset your password for your Inventory Management System account.\n\nClick the link below to reset your password:\n\n{{resetUrl}}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, please ignore this email or contact support if you have concerns.\n\nBest regards,\nInventory Management Team`
    },
    employeeInvitation: {
        subject: 'Welcome to Inventory Management System - Account Created',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Inventory Management System</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .info-box { background: white; border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin: 15px 0; }
          .info-row { display: flex; margin-bottom: 8px; }
          .info-label { font-weight: bold; width: 120px; }
          .login-button { display: inline-block; background: #10B981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Inventory Management System</h1>
          </div>
          <div class="content">
            <h2>Hello {{name}},</h2>
            <p>An account has been created for you in the Inventory Management System with the following details:</p>
            
            <div class="info-box">
              <div class="info-row">
                <div class="info-label">Email:</div>
                <div>{{email}}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Temporary Password:</div>
                <div><strong>{{password}}</strong></div>
              </div>
              <div class="info-row">
                <div class="info-label">Role:</div>
                <div>{{role}}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Store:</div>
                <div>{{storeName}} ({{storeLocation}})</div>
              </div>
              <div class="info-row">
                <div class="info-label">Position:</div>
                <div>{{position}}</div>
              </div>
            </div>
            
            <p>Please log in using the temporary password and change it immediately for security:</p>
            
            <a href="{{loginUrl}}" class="login-button">Login to System</a>
            
            <p><strong>Important Security Note:</strong></p>
            <ul>
              <li>Change your password immediately after first login</li>
              <li>Never share your password with anyone</li>
              <li>Log out after each session</li>
            </ul>
            
            {{#if verificationCode}}
            <p>Verification Code: <strong>{{verificationCode}}</strong> (Expires in 7 days)</p>
            {{/if}}
            
            <p>Best regards,<br>Inventory Management Team</p>
          </div>
          <div class="footer">
            <p>This email was sent by Inventory Management System</p>
            <p>© {{year}} Inventory Management System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `Hello {{name}},\n\nAn account has been created for you in the Inventory Management System with the following details:\n\nEmail: {{email}}\nTemporary Password: {{password}}\nRole: {{role}}\nStore: {{storeName}} ({{storeLocation}})\nPosition: {{position}}\n\nPlease log in using the temporary password and change it immediately for security.\n\nLogin URL: {{loginUrl}}\n\nImportant Security Note:\n- Change your password immediately after first login\n- Never share your password with anyone\n- Log out after each session\n\n{{#if verificationCode}}Verification Code: {{verificationCode}} (Expires in 7 days){{/if}}\n\nBest regards,\nInventory Management Team`
    },
    saleConfirmation: {
        subject: 'Sale Confirmation - Invoice #{{saleId}}',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sale Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .invoice-header { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .invoice-details { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .invoice-details th { background: #f0f0f0; padding: 10px; text-align: left; }
          .invoice-details td { padding: 10px; border-bottom: 1px solid #ddd; }
          .total-row { font-weight: bold; background: #f9f9f9; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Sale Confirmation</h1>
          </div>
          <div class="content">
            <h2>Thank you for your purchase!</h2>
            
            <div class="invoice-header">
              <p><strong>Invoice #:</strong> {{saleId}}</p>
              <p><strong>Date:</strong> {{saleDate}}</p>
              <p><strong>Store:</strong> {{storeName}}</p>
              <p><strong>Employee:</strong> {{employeeName}}</p>
            </div>
            
            <h3>Items Purchased:</h3>
            <table class="invoice-details">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {{#each items}}
                <tr>
                  <td>{{this.name}}</td>
                  <td>{{this.quantity}}</td>
                  <td>{{this.price}}</td>
                  <td>{{this.total}}</td>
                </tr>
                {{/each}}
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="3" style="text-align: right;"><strong>Total:</strong></td>
                  <td><strong>{{totalAmount}}</strong></td>
                </tr>
              </tfoot>
            </table>
            
            <p>If you have any questions about your purchase, please contact our store.</p>
            
            <p>Best regards,<br>{{storeName}} Team</p>
          </div>
          <div class="footer">
            <p>This is an automated receipt from {{storeName}}</p>
            <p>Store Location: {{storeLocation}}</p>
            <p>Contact: {{storeContact}}</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `Thank you for your purchase!\n\nInvoice #: {{saleId}}\nDate: {{saleDate}}\nStore: {{storeName}}\nEmployee: {{employeeName}}\n\nItems Purchased:\n{{#each items}}- {{this.name}} x{{this.quantity}} @ {{this.price}} = {{this.total}}\n{{/each}}\nTotal: {{totalAmount}}\n\nIf you have any questions about your purchase, please contact our store.\n\nBest regards,\n{{storeName}} Team`
    },
    lowStockAlert: {
        subject: '⚠️ Low Stock Alert - {{productName}}',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Low Stock Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .alert-box { background: #FEF3C7; border: 2px solid #F59E0B; border-radius: 5px; padding: 15px; margin: 20px 0; }
          .product-info { background: white; border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin: 15px 0; }
          .info-row { display: flex; margin-bottom: 8px; }
          .info-label { font-weight: bold; width: 150px; }
          .action-button { display: inline-block; background: #F59E0B; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Low Stock Alert</h1>
          </div>
          <div class="content">
            <div class="alert-box">
              <h3>⚠️ Attention: Product Stock is Low</h3>
              <p>The following product is running low on stock and may need to be reordered soon.</p>
            </div>
            
            <div class="product-info">
              <div class="info-row">
                <div class="info-label">Product Name:</div>
                <div><strong>{{productName}}</strong></div>
              </div>
              <div class="info-row">
                <div class="info-label">Current Stock:</div>
                <div><span style="color: #DC2626; font-weight: bold;">{{currentStock}}</span> units</div>
              </div>
              <div class="info-row">
                <div class="info-label">Threshold:</div>
                <div>{{threshold}} units</div>
              </div>
              <div class="info-row">
                <div class="info-label">Store:</div>
                <div>{{storeName}} ({{storeLocation}})</div>
              </div>
              <div class="info-row">
                <div class="info-label">Product Type:</div>
                <div>{{productType}}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Last Updated:</div>
                <div>{{lastUpdated}}</div>
              </div>
            </div>
            
            <p>Please take appropriate action to restock this item to avoid running out.</p>
            
            <a href="{{dashboardUrl}}" class="action-button">View Inventory Dashboard</a>
            
            <p>Best regards,<br>Inventory Management System</p>
          </div>
          <div class="footer">
            <p>This is an automated alert from Inventory Management System</p>
            <p>Configure alert thresholds in your dashboard settings</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `⚠️ LOW STOCK ALERT\n\nProduct Name: {{productName}}\nCurrent Stock: {{currentStock}} units\nThreshold: {{threshold}} units\nStore: {{storeName}} ({{storeLocation}})\nProduct Type: {{productType}}\nLast Updated: {{lastUpdated}}\n\nPlease take appropriate action to restock this item to avoid running out.\n\nView Inventory Dashboard: {{dashboardUrl}}\n\nBest regards,\nInventory Management System`
    },
    dailySalesReport: {
        subject: '📊 Daily Sales Report - {{date}}',
        html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Daily Sales Report</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .summary-box { background: white; border: 1px solid #ddd; border-radius: 5px; padding: 20px; margin: 20px 0; }
          .metric { display: inline-block; width: 48%; margin: 10px 1%; text-align: center; }
          .metric-value { font-size: 28px; font-weight: bold; color: #4F46E5; }
          .metric-label { color: #666; font-size: 14px; }
          .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .table th { background: #f0f0f0; padding: 10px; text-align: left; }
          .table td { padding: 10px; border-bottom: 1px solid #ddd; }
          .positive { color: #10B981; }
          .negative { color: #DC2626; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Daily Sales Report</h1>
          </div>
          <div class="content">
            <h2>{{date}} - {{storeName}}</h2>
            
            <div class="summary-box">
              <div class="metric">
                <div class="metric-value">{{totalRevenue}}</div>
                <div class="metric-label">Total Revenue</div>
              </div>
              <div class="metric">
                <div class="metric-value">{{totalSales}}</div>
                <div class="metric-label">Total Sales</div>
              </div>
              <div class="metric">
                <div class="metric-value">{{averageSale}}</div>
                <div class="metric-label">Average Sale</div>
              </div>
              <div class="metric">
                <div class="metric-value {{revenueChangeClass}}">{{revenueChange}}%</div>
                <div class="metric-label">vs. Yesterday</div>
              </div>
            </div>
            
            <h3>Top Products</h3>
            <table class="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity Sold</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {{#each topProducts}}
                <tr>
                  <td>{{this.name}}</td>
                  <td>{{this.quantity}}</td>
                  <td>{{this.revenue}}</td>
                </tr>
                {{/each}}
              </tbody>
            </table>
            
            <h3>Top Employees</h3>
            <table class="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Sales Count</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {{#each topEmployees}}
                <tr>
                  <td>{{this.name}}</td>
                  <td>{{this.salesCount}}</td>
                  <td>{{this.revenue}}</td>
                </tr>
                {{/each}}
              </tbody>
            </table>
            
            <p><a href="{{reportUrl}}">View Detailed Report</a></p>
            
            <p>Best regards,<br>Inventory Management System</p>
          </div>
          <div class="footer">
            <p>This is an automated daily report from Inventory Management System</p>
            <p>Report generated at: {{generatedTime}}</p>
          </div>
        </div>
      </body>
      </html>
    `,
        text: `DAILY SALES REPORT - {{date}} - {{storeName}}\n\nSummary:\nTotal Revenue: {{totalRevenue}}\nTotal Sales: {{totalSales}}\nAverage Sale: {{averageSale}}\nvs. Yesterday: {{revenueChange}}%\n\nTop Products:\n{{#each topProducts}}- {{this.name}}: {{this.quantity}} sold, {{this.revenue}} revenue\n{{/each}}\n\nTop Employees:\n{{#each topEmployees}}- {{this.name}}: {{this.salesCount}} sales, {{this.revenue}} revenue\n{{/each}}\n\nView Detailed Report: {{reportUrl}}\n\nBest regards,\nInventory Management System`
    }
};
class EmailService {
    transporter;
    config;
    templateCache = new Map();
    constructor() {
        this.config = {
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || ''
            },
            from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
            fromName: process.env.SMTP_FROM_NAME || 'Inventory Management System'
        };
        if (!this.config.auth.user || !this.config.auth.pass) {
            console.warn('SMTP credentials not configured. Email service will run in development mode.');
        }
        this.transporter = nodemailer_1.default.createTransport(this.config);
        this.verifyConnection();
    }
    async verifyConnection() {
        try {
            await this.transporter.verify();
            console.log('SMTP connection verified successfully');
        }
        catch (error) {
            console.error('Failed to verify SMTP connection:', error);
            console.warn('Email service may not work properly. Check SMTP configuration.');
        }
    }
    async compileTemplate(templateName, templateData) {
        if (this.templateCache.has(templateName)) {
            const template = this.templateCache.get(templateName);
            const html = template(templateData);
            return { html };
        }
        try {
            const templatePath = path_1.default.join(__dirname, '..', 'templates', 'emails', `${templateName}.hbs`);
            const templateContent = await readFile(templatePath, 'utf-8');
            const template = handlebars_1.default.compile(templateContent);
            this.templateCache.set(templateName, template);
            const html = template(templateData);
            return { html };
        }
        catch (error) {
            const builtInTemplate = emailTemplates[templateName];
            if (!builtInTemplate) {
                throw new Error(`Template ${templateName} not found`);
            }
            const htmlTemplate = handlebars_1.default.compile(builtInTemplate.html);
            const html = htmlTemplate(templateData);
            let text;
            if (builtInTemplate.text) {
                const textTemplate = handlebars_1.default.compile(builtInTemplate.text);
                text = textTemplate(templateData);
            }
            return { html, text };
        }
    }
    async sendEmail(options) {
        try {
            const mailOptions = {
                from: this.config.fromName
                    ? `"${this.config.fromName}" <${this.config.from}>`
                    : this.config.from,
                to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
                subject: options.subject,
                html: options.html,
                text: options.text,
                attachments: options.attachments,
                cc: options.cc,
                bcc: options.bcc,
                replyTo: options.replyTo
            };
            if (options.template) {
                const templateData = {
                    ...options.templateData,
                    year: new Date().getFullYear(),
                    appName: 'Inventory Management System',
                    appUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
                };
                const { html, text } = await this.compileTemplate(options.template, templateData);
                mailOptions.html = html;
                mailOptions.text = text || mailOptions.text;
            }
            const info = await this.transporter.sendMail(mailOptions);
            console.log('Email sent successfully:', {
                messageId: info.messageId,
                to: options.to,
                subject: options.subject,
                template: options.template
            });
        }
        catch (error) {
            console.error('Failed to send email:', {
                error: error.message,
                to: options.to,
                subject: options.subject,
                template: options.template
            });
            if (process.env.NODE_ENV !== 'production') {
                throw error;
            }
        }
    }
    async sendVerificationEmail(to, name, code) {
        await this.sendEmail({
            to,
            subject: 'Verify Your Email - Inventory Management System',
            template: 'verification',
            templateData: {
                name,
                code,
                verificationUrl: `${process.env.FRONTEND_URL}/verify-email?code=${code}`
            }
        });
    }
    async sendPasswordResetEmail(to, name, resetToken) {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(to)}`;
        await this.sendEmail({
            to,
            subject: 'Password Reset Request - Inventory Management System',
            template: 'passwordReset',
            templateData: {
                name,
                resetUrl,
                token: resetToken
            }
        });
    }
    async sendEmployeeInvitation(options) {
        await this.sendEmail({
            to: options.to,
            subject: 'Welcome to Inventory Management System - Account Created',
            template: 'employeeInvitation',
            templateData: {
                name: options.name,
                email: options.email,
                password: options.password,
                role: options.role,
                storeName: options.storeName,
                storeLocation: options.storeLocation,
                position: options.position,
                verificationCode: options.verificationCode,
                loginUrl: `${process.env.FRONTEND_URL}/login`
            }
        });
    }
    async sendSaleConfirmation(options) {
        await this.sendEmail({
            to: options.to,
            subject: `Sale Confirmation - Invoice #${options.saleId}`,
            template: 'saleConfirmation',
            templateData: {
                saleId: options.saleId,
                saleDate: options.saleDate,
                storeName: options.storeName,
                storeLocation: options.storeLocation,
                storeContact: options.storeContact,
                employeeName: options.employeeName,
                items: options.items,
                totalAmount: options.totalAmount
            }
        });
    }
    async sendLowStockAlert(options) {
        await this.sendEmail({
            to: options.to,
            subject: `⚠️ Low Stock Alert - ${options.productName}`,
            template: 'lowStockAlert',
            templateData: {
                productName: options.productName,
                currentStock: options.currentStock,
                threshold: options.threshold,
                storeName: options.storeName,
                storeLocation: options.storeLocation,
                productType: options.productType,
                lastUpdated: options.lastUpdated,
                dashboardUrl: `${process.env.FRONTEND_URL}/dashboard/inventory`
            }
        });
    }
    async sendDailySalesReport(options) {
        await this.sendEmail({
            to: options.to,
            subject: `📊 Daily Sales Report - ${options.date}`,
            template: 'dailySalesReport',
            templateData: {
                storeName: options.storeName,
                date: options.date,
                totalRevenue: options.totalRevenue,
                totalSales: options.totalSales,
                averageSale: options.averageSale,
                revenueChange: options.revenueChange,
                revenueChangeClass: options.revenueChangeClass,
                topProducts: options.topProducts,
                topEmployees: options.topEmployees,
                reportUrl: `${process.env.FRONTEND_URL}/reports/sales/daily`,
                generatedTime: new Date().toLocaleString()
            }
        });
    }
    async sendTemplateEmail(to, templateName, templateData, subject) {
        const template = emailTemplates[templateName];
        if (!template && !subject) {
            throw new Error(`Template ${templateName} not found and no subject provided`);
        }
        await this.sendEmail({
            to,
            subject: subject || template.subject,
            template: templateName,
            templateData
        });
    }
    async sendEmailWithAttachments(to, subject, html, attachments) {
        await this.sendEmail({
            to,
            subject,
            html,
            attachments
        });
    }
    isConfigured() {
        return !!(this.config.auth.user && this.config.auth.pass);
    }
    getConfig() {
        return {
            ...this.config,
            auth: {
                user: this.config.auth.user,
                pass: !!this.config.auth.pass
            }
        };
    }
}
exports.emailService = new EmailService();
exports.sendEmail = exports.emailService.sendEmail.bind(exports.emailService);
const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
    }).format(amount);
};
exports.formatCurrency = formatCurrency;
const formatDate = (date, format = 'medium') => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const options = {
        year: 'numeric',
        month: format === 'short' ? 'short' : 'long',
        day: 'numeric',
        hour: format === 'full' ? '2-digit' : undefined,
        minute: format === 'full' ? '2-digit' : undefined
    };
    return dateObj.toLocaleDateString('en-US', options);
};
exports.formatDate = formatDate;
//# sourceMappingURL=email.js.map