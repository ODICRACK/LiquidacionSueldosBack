const express = require('express');
const router = express.Router();
const { getCategorias, createCategoria, updateCategoria, bajaCategoria, reactivarCategoria } = require('../controllers/categoriasController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', getCategorias);
router.post('/', createCategoria);
router.put('/:id', updateCategoria);
router.delete('/:id', bajaCategoria);
router.put('/:id/reactivar', reactivarCategoria);

module.exports = router;
