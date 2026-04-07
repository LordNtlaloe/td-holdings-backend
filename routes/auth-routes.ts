// routes/auth.routes.ts
import { Router } from 'express';
import {
  register,
  verify,
  login,
  requestPasswordReset,
  resetPassword,
  refreshToken,
  getUsers,
  getUserById,
  updateUser,
  changePassword
} from '../controllers/auth-controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/verify', verify);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Protected routes
router.get('/users', authenticate, authorize(['ADMIN', 'MANAGER']), getUsers);
router.get('/users/:id', authenticate, authorize(['ADMIN', 'MANAGER']), getUserById);
router.put('/users/:id', authenticate, authorize(['ADMIN', 'MANAGER']), updateUser);
router.post('/users/:id/change-password', authenticate, changePassword);

// User profile routes
router.get('/profile', authenticate, (req, res) => {
  // This would use a separate controller function, but you can add it later
  res.json({ user: (req as any).user });
});

export default router;