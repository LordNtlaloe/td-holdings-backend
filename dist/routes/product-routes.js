"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const product_controller_1 = require("../controllers/product-controller");
const router = express_1.default.Router();
const productController = new product_controller_1.ProductController();
router.get('/', auth_1.authenticate, productController.getProducts);
router.get('/low-stock', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), productController.getLowStock);
router.get('/:id', auth_1.authenticate, (0, auth_1.requireProductAccess)(), productController.getProductById);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.createProduct), (0, auth_1.logActivity)('CREATE_PRODUCT', 'PRODUCT'), productController.createProduct);
router.post('/transfer', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.validateRequest)(validation_1.validationSchemas.transferProduct), (0, auth_1.logActivity)('TRANSFER_PRODUCT', 'PRODUCT'), productController.transferProduct);
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireProductAccess)(), (0, auth_1.validateRequest)(validation_1.validationSchemas.updateProduct), (0, auth_1.logActivity)('UPDATE_PRODUCT', 'PRODUCT'), productController.updateProduct);
router.patch('/:id/quantity', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireProductAccess)(), (0, auth_1.validateRequest)(validation_1.validationSchemas.updateQuantity), (0, auth_1.logActivity)('UPDATE_PRODUCT_QUANTITY', 'PRODUCT'), productController.updateQuantity);
router.delete('/:id', auth_1.authenticate, (0, auth_1.requireRole)(['ADMIN', 'MANAGER']), (0, auth_1.requireProductAccess)(), (0, auth_1.logActivity)('DELETE_PRODUCT', 'PRODUCT'), productController.deleteProduct);
exports.default = router;
//# sourceMappingURL=product-routes.js.map