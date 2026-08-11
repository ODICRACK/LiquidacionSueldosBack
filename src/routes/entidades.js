const express = require('express');
const router = express.Router();
const { getClientes, createCliente, createEmpleado } = require('../controllers/entidadesController');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/db');

router.use(authMiddleware);

router.get('/clientes', getClientes);
router.post('/clientes', createCliente);
router.post('/empleados', createEmpleado);

// Endpoint para el Modal de Copiar Configuración
router.get('/empleados/:id/liquidaciones', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, anio, mes, estado FROM liquidacion WHERE empleado_id = $1 AND eliminado = FALSE ORDER BY anio DESC, mes DESC',
            [id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener liquidaciones del empleado' });
    }
});

module.exports = router;