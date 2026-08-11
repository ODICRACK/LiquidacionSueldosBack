const pool = require('../config/db');

// Obtiene todos los clientes y anida sus empleados activos con sus liquidaciones
const getClientes = async (req, res) => {
    try {
        const clientesRes = await pool.query(
            'SELECT id, cuit, razon_social, domicilio_laboral FROM cliente WHERE eliminado = FALSE ORDER BY razon_social'
        );
        const empleadosRes = await pool.query(
            'SELECT id, cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id FROM empleado WHERE eliminado = FALSE ORDER BY apellido, nombre'
        );
        const liquidacionesRes = await pool.query(
            'SELECT id, empleado_id, anio, mes, estado FROM liquidacion WHERE eliminado = FALSE'
        );

        const clientes = clientesRes.rows.map(cliente => ({
            ...cliente,
            empleados: empleadosRes.rows
                .filter(e => e.cliente_id === cliente.id)
                .map(emp => ({
                    ...emp,
                    liquidaciones: liquidacionesRes.rows.filter(l => l.empleado_id === emp.id)
                }))
        }));

        res.json(clientes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el listado.' });
    }
};

const createCliente = async (req, res) => {
    const { cuit, razon_social, domicilio_laboral } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO cliente (cuit, razon_social, domicilio_laboral) VALUES ($1, $2, $3) RETURNING id',
            [cuit, razon_social, domicilio_laboral]
        );
        res.json({ id: result.rows[0].id, mensaje: 'Cliente creado exitosamente.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear el cliente.' });
    }
};

const createEmpleado = async (req, res) => {
    const { cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO empleado (cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id]
        );
        res.json({ id: result.rows[0].id, mensaje: 'Empleado creado exitosamente.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear el empleado.' });
    }
};

module.exports = { getClientes, createCliente, createEmpleado };