"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseController = void 0;
const prisma_1 = require("../lib/prisma");
class BaseController {
    async getUserWithStore(req) {
        if (!req.user)
            throw new Error('User not authenticated');
        return await prisma_1.prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                employee: {
                    include: {
                        store: true
                    }
                }
            }
        });
    }
    filterByStore(userRole, userStoreId) {
        if (userRole === 'ADMIN') {
            return {};
        }
        return { storeId: userStoreId };
    }
    getStoreFilter(userRole, userStoreId, requestedStoreId) {
        if (userRole === 'ADMIN') {
            return requestedStoreId ? { storeId: requestedStoreId } : {};
        }
        return { storeId: userStoreId };
    }
    handleError(res, error, message = 'An error occurred') {
        console.error(error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Duplicate entry' });
        }
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Record not found' });
        }
        return res.status(500).json({ error: message });
    }
}
exports.BaseController = BaseController;
//# sourceMappingURL=base-controller.js.map