const express = require('express');
const router = express.Router();
const { createItem, deleteItem } = require('../controllers/itemsController');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/db');

router.use(authMiddleware);

// Endpoint para listar items en el frontend
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM item WHERE eliminado = FALSE ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener items' });
    }
});

router.post('/', createItem);
router.delete('/:id', deleteItem);

module.exports = router;