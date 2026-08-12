const express = require('express');
const router = express.Router();
const {
    getClientes, getCliente, getEmpleado,
    createCliente, updateCliente, bajaCliente,
    createEmpleado, updateEmpleado, bajaEmpleado
} = require('../controllers/entidadesController');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../config/db');

router.use(authMiddleware);

router.get('/clientes', getClientes);
router.get('/clientes/:id', getCliente);
router.post('/clientes', createCliente);
router.put('/clientes/:id', updateCliente);
router.delete('/clientes/:id', bajaCliente);

router.get('/empleados/:id', getEmpleado);
router.post('/empleados', createEmpleado);
router.put('/empleados/:id', updateEmpleado);
router.delete('/empleados/:id', bajaEmpleado);

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
