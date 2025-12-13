// // controllers/base.controller.ts
// import { Request, Response } from 'express';
// import { prisma } from '../../lib/prisma';
// import { AuthRequest } from '../../middleware/auth';

// export class BaseController {
//     protected async getUserWithStore(req: AuthRequest) {
//         if (!req.user) throw new Error('User not authenticated');

//         return await prisma.user.findUnique({
//             where: { id: req.user.id },
//             include: {
//                 employee: {
//                     include: {
//                         store: true
//                     }
//                 }
//             }
//         });
//     }

//     protected filterByStore(userRole: string, userStoreId?: string) {
//         if (userRole === 'ADMIN') {
//             return {};
//         }
//         return { storeId: userStoreId };
//     }

//     protected getStoreFilter(userRole: string, userStoreId?: string, requestedStoreId?: string) {
//         if (userRole === 'ADMIN') {
//             return requestedStoreId ? { storeId: requestedStoreId } : {};
//         }
//         return { storeId: userStoreId };
//     }

//     protected handleError(res: Response, error: any, message: string = 'An error occurred') {
//         console.error(error);
//         if (error.code === 'P2002') {
//             return res.status(400).json({ error: 'Duplicate entry' });
//         }
//         if (error.code === 'P2025') {
//             return res.status(404).json({ error: 'Record not found' });
//         }
//         return res.status(500).json({ error: message });
//     }
// }