import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { prisma } from "../lib/prisma";

/**
 * Custom Joi extensions for database validation
 */
export const customValidators = {
    // Check if user exists
    userExists: Joi.extend((joi) => ({
        type: 'string',
        base: joi.string(),
        messages: {
            'string.userExists': 'User does not exist',
            'string.userInactive': 'User is inactive'
        },
        validate(value, helpers) {
            // Only validate if value exists
            if (!value) {
                return { value };
            }

            // In middleware, you would typically do async validation
            // For Joi extensions, you can add flags or use pre-hooks
            return { value };
        }
    })),

    // Check if store exists
    storeExists: Joi.extend((joi) => ({
        type: 'string',
        base: joi.string(),
        messages: {
            'string.storeExists': 'Store does not exist'
        },
        validate(value, helpers) {
            return { value };
        }
    })),

    // Check if product exists
    productExists: Joi.extend((joi) => ({
        type: 'string',
        base: joi.string(),
        messages: {
            'string.productExists': 'Product does not exist'
        },
        validate(value, helpers) {
            return { value };
        }
    })),

    // Check if inventory exists for product-store combination
    inventoryExists: Joi.object({
        productId: Joi.string().required(),
        storeId: Joi.string().required()
    }).custom(async (value, helpers) => {
        const inventory = await prisma.inventory.findUnique({
            where: {
                productId_storeId: {
                    productId: value.productId,
                    storeId: value.storeId
                }
            }
        });

        if (!inventory) {
            throw new Error('Inventory record not found for this product and store');
        }

        return value;
    })
};

/**
 * Async validation middleware for database checks
 */
export const validateEntityExists = (entity: 'user' | 'store' | 'product' | 'employee', paramName: string = 'id') => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const id = req.params[paramName] || req.body?.[`${entity}Id`];

        if (!id) {
            res.status(400).json({ error: `${entity.toUpperCase()}_ID_REQUIRED` });
            return;
        }

        try {
            let exists = false;

            switch (entity) {
                case 'user':
                    exists = !!(await prisma.user.findUnique({ where: { id } }));
                    break;
                case 'store':
                    exists = !!(await prisma.store.findUnique({ where: { id } }));
                    break;
                case 'product':
                    exists = !!(await prisma.product.findUnique({ where: { id } }));
                    break;
                case 'employee':
                    exists = !!(await prisma.employee.findUnique({ where: { id } }));
                    break;
            }

            if (!exists) {
                res.status(404).json({ error: `${entity.toUpperCase()}_NOT_FOUND` });
                return;
            }

            next();
        } catch (error) {
            console.error(`Error validating ${entity} existence:`, error);
            res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
        }
    };
};