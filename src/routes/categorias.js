const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/db');

router.use(authMiddleware);

// Endpoint para el formulario de Items
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categoria WHERE eliminado = FALSE ORDER BY nombre');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

module.exports = router;