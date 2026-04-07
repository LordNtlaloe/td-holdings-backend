// routes/transfer.routes.ts
import { Router } from 'express';
import {
    getTransfers,
    getTransferById,
    createTransfer,
    updateTransferStatus,
    getPendingTransfers,
    getTransferReport,
    bulkCreateTransfers
} from '../controllers/transfer-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize(['ADMIN', 'MANAGER']), getTransfers);
router.get('/:id', authenticate, authorize(['ADMIN', 'MANAGER']), getTransferById);
router.post('/', authenticate, authorize(['ADMIN', 'MANAGER']), createTransfer);
router.put('/:id/status', authenticate, authorize(['ADMIN', 'MANAGER']), updateTransferStatus);
router.get('/pending', authenticate, authorize(['ADMIN', 'MANAGER']), getPendingTransfers);
router.get('/reports/summary', authenticate, authorize(['ADMIN', 'MANAGER']), getTransferReport);
router.post('/bulk', authenticate, authorize(['ADMIN', 'MANAGER']), bulkCreateTransfers);

export default router;