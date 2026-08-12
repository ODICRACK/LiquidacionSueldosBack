const pool = require('../config/db');
const { validarRequerido, validarNumeroPositivo } = require('../utils/validators');

// Obtiene todos los clientes y anida sus empleados con sus liquidaciones.
// Incluye clientes y empleados dados de baja para que el frontend los muestre
// en secciones separadas (los históricos siguen siendo consultables).
const getClientes = async (req, res) => {
    try {
        const clientesRes = await pool.query(
            'SELECT id, cuit, razon_social, domicilio_laboral, eliminado FROM cliente ORDER BY razon_social'
        );
        const empleadosRes = await pool.query(
            'SELECT id, cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id, sueldo_basico, eliminado FROM empleado ORDER BY apellido, nombre'
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

const getCliente = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM cliente WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el cliente.' });
    }
};

const getEmpleado = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM empleado WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el empleado.' });
    }
};

const createCliente = async (req, res) => {
    let cuit, razon_social, domicilio_laboral;
    try {
        cuit = validarRequerido(req.body.cuit, 'CUIT');
        razon_social = validarRequerido(req.body.razon_social, 'razón social');
        domicilio_laboral = req.body.domicilio_laboral || null;
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const result = await pool.query(
            'INSERT INTO cliente (cuit, razon_social, domicilio_laboral) VALUES ($1, $2, $3) RETURNING id',
            [cuit, razon_social, domicilio_laboral]
        );
        res.json({ id: result.rows[0].id, mensaje: 'Cliente creado exitosamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el cliente.' });
    }
};

const updateCliente = async (req, res) => {
    const { id } = req.params;
    let cuit, razon_social, domicilio_laboral;
    try {
        cuit = validarRequerido(req.body.cuit, 'CUIT');
        razon_social = validarRequerido(req.body.razon_social, 'razón social');
        domicilio_laboral = req.body.domicilio_laboral || null;
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const result = await pool.query(
            'UPDATE cliente SET cuit = $1, razon_social = $2, domicilio_laboral = $3 WHERE id = $4 RETURNING id',
            [cuit, razon_social, domicilio_laboral, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
        res.json({ mensaje: 'Cliente actualizado exitosamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el cliente.' });
    }
};

// Baja lógica de un cliente. En la misma transacción da de baja a todos sus empleados.
const bajaCliente = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const resCliente = await client.query('UPDATE cliente SET eliminado = TRUE WHERE id = $1 RETURNING id', [id]);
        if (resCliente.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cliente no encontrado.' });
        }

        await client.query('UPDATE empleado SET eliminado = TRUE WHERE cliente_id = $1', [id]);

        await client.query('COMMIT');
        res.json({ mensaje: 'Cliente dado de baja junto con todos sus empleados.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Error al dar de baja el cliente.' });
    } finally {
        client.release();
    }
};

const createEmpleado = async (req, res) => {
    const { cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id, sueldo_basico } = req.body;

    try {
        validarRequerido(cuil, 'CUIL');
        validarRequerido(nombre, 'nombre');
        validarRequerido(apellido, 'apellido');
        validarRequerido(cliente_id, 'cliente');
        validarNumeroPositivo(sueldo_basico, 'sueldo básico');
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const clienteRes = await pool.query('SELECT id FROM cliente WHERE id = $1 AND eliminado = FALSE', [cliente_id]);
        if (clienteRes.rows.length === 0) {
            return res.status(400).json({ error: 'El cliente no existe o está dado de baja.' });
        }

        const result = await pool.query(
            'INSERT INTO empleado (cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id, sueldo_basico) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [cuil, nombre, apellido, nro_legajo || null, fecha_ingreso || null, cliente_id, sueldo_basico || 0]
        );
        res.json({ id: result.rows[0].id, mensaje: 'Empleado creado exitosamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear el empleado.' });
    }
};

const updateEmpleado = async (req, res) => {
    const { id } = req.params;
    const { cuil, nombre, apellido, nro_legajo, fecha_ingreso, cliente_id, sueldo_basico } = req.body;

    try {
        validarRequerido(cuil, 'CUIL');
        validarRequerido(nombre, 'nombre');
        validarRequerido(apellido, 'apellido');
        validarRequerido(cliente_id, 'cliente');
        validarNumeroPositivo(sueldo_basico, 'sueldo básico');
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const clienteRes = await pool.query('SELECT id FROM cliente WHERE id = $1 AND eliminado = FALSE', [cliente_id]);
        if (clienteRes.rows.length === 0) {
            return res.status(400).json({ error: 'El cliente no existe o está dado de baja.' });
        }

        const result = await pool.query(
            `UPDATE empleado SET cuil = $1, nombre = $2, apellido = $3, nro_legajo = $4, fecha_ingreso = $5, cliente_id = $6, sueldo_basico = $7
             WHERE id = $8 RETURNING id`,
            [cuil, nombre, apellido, nro_legajo || null, fecha_ingreso || null, cliente_id, sueldo_basico || 0, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
        res.json({ mensaje: 'Empleado actualizado exitosamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar el empleado.' });
    }
};

const bajaEmpleado = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('UPDATE empleado SET eliminado = TRUE WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
        res.json({ mensaje: 'Empleado dado de baja.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al dar de baja el empleado.' });
    }
};

module.exports = {
    getClientes, getCliente, getEmpleado,
    createCliente, updateCliente, bajaCliente,
    createEmpleado, updateEmpleado, bajaEmpleado
};
