const pool = require('../config/db');
const { redondear } = require('../utils/mathEngine');
const { validarMes, validarAnio } = require('../utils/validators');

const crearLiquidacion = async (req, res) => {
    const { empleado_id, mes, anio, estado, categoria_laboral, banco, fecha_pago_aportes } = req.body;

    try {
        // 1. Crear la liquidación base
        const resultLiq = await pool.query(
            `INSERT INTO liquidacion (empleado_id, mes, anio, estado, categoria_laboral, banco, fecha_pago_aportes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [empleado_id, mes, anio, estado || 'BORRADOR', categoria_laboral, banco, fecha_pago_aportes]
        );
        
        const liquidacionId = resultLiq.rows[0].id;

        // 2. Auto-Creación Inteligente
        const ultimaLiqRes = await pool.query(`
            SELECT id FROM liquidacion 
            WHERE empleado_id = $1 AND estado = 'FINALIZADA' AND eliminado = FALSE
            ORDER BY anio DESC, mes DESC LIMIT 1
        `, [empleado_id]);

        if (ultimaLiqRes.rows.length > 0) {
            const idAnterior = ultimaLiqRes.rows[0].id;
            
            // AHORA INCLUIMOS item_id EN LA CLONACIÓN
            await pool.query(`
                INSERT INTO liquidacion_item (
                    liquidacion_id, item_id, token, nombre, tipo, naturaleza, formula, 
                    base_token, porcentaje, valor_ingresado, activo, unidad_imprimible, base_imprimible
                )
                SELECT 
                    $1, item_id, token, nombre, tipo, naturaleza, formula, 
                    base_token, porcentaje, NULL, activo, unidad_imprimible, base_imprimible
                FROM liquidacion_item 
                WHERE liquidacion_id = $2
            `, [liquidacionId, idAnterior]);
        } else {
            // AHORA INCLUIMOS id (COMO item_id) DESDE LA TABLA MAESTRA
            await pool.query(`
                INSERT INTO liquidacion_item (
                    liquidacion_id, item_id, token, nombre, tipo, naturaleza, formula, 
                    base_token, porcentaje, valor_ingresado, activo, unidad_imprimible, base_imprimible
                )
                SELECT 
                    $1, id, token, nombre, tipo, naturaleza, formula, 
                    base_token, porcentaje, NULL, TRUE, unidad_imprimible, base_imprimible
                FROM item 
                WHERE eliminado = FALSE
            `, [liquidacionId]);
        }

        res.status(201).json({ message: 'Liquidación creada con éxito', id: liquidacionId });

    } catch (error) {
        console.error('Error al crear liquidación:', error);
        res.status(500).json({ error: 'Error al crear la liquidación' });
    }
};

const getLiquidacion = async (req, res) => {
    const { id } = req.params;

    try {
        const liqRes = await pool.query(`
            SELECT l.*, e.fecha_ingreso 
            FROM liquidacion l
            JOIN empleado e ON l.empleado_id = e.id
            WHERE l.id = $1 AND l.eliminado = FALSE
        `, [id]);
        if (liqRes.rows.length === 0) return res.status(404).json({ error: 'Liquidación no encontrada.' });

        const itemsRes = await pool.query('SELECT * FROM liquidacion_item WHERE liquidacion_id = $1 ORDER BY id', [id]);
        const categoriasRes = await pool.query('SELECT * FROM liquidacion_categoria WHERE liquidacion_id = $1 ORDER BY id', [id]);

        res.json({
            ...liqRes.rows[0],
            items: itemsRes.rows,
            categorias: categoriasRes.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los datos de la liquidación.' });
    }
};

const actualizarBorrador = async (req, res) => {
    const { id } = req.params;
    const { items, resultados } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const liqRes = await client.query('SELECT estado, empleado_id FROM liquidacion WHERE id = $1', [id]);
        if (liqRes.rows[0].estado !== 'BORRADOR') {
            throw new Error('No se puede modificar una liquidación finalizada.');
        }
        const empleadoId = liqRes.rows[0].empleado_id;

        for (const item of items) {
            const activo = item.token === 'SB' ? true : item.activo;
            await client.query(
                `UPDATE liquidacion_item 
                 SET activo = $1, valor_ingresado = $2, porcentaje = $3, resultado = $4 
                 WHERE id = $5 AND liquidacion_id = $6`,
                [
                    activo,
                    item.tipo === 'MANUAL' ? (item.valor_ingresado || null) : null,
                    item.tipo === 'PORCENTAJE' ? (item.porcentaje || null) : null,
                    resultados[item.id] || 0,
                    item.id,
                    id
                ]
            );
        }

        const sbr = items.find(i => i.token === 'SB' && i.valor_ingresado !== null && i.valor_ingresado !== '');
        if (sbr) {
            await client.query(
                'UPDATE empleado SET sueldo_basico = $1 WHERE id = $2',
                [parseFloat(sbr.valor_ingresado) || 0, empleadoId]
            );
        }

        const categoriasTotales = {};

        for (const item of items) {
            if (!item.activo) continue;

            const relacionesRes = await client.query(
                'SELECT categoria_id, operacion FROM item_categoria WHERE item_id = $1',
                [item.item_id]
            );

            for (const rel of relacionesRes.rows) {
                const catId = rel.categoria_id;
                if (!categoriasTotales[catId]) categoriasTotales[catId] = 0;

                const valor = resultados[item.id] || 0;
                if (rel.operacion === 'SUMA') {
                    categoriasTotales[catId] += valor;
                } else if (rel.operacion === 'RESTA') {
                    categoriasTotales[catId] -= valor;
                }
            }
        }

        for (const [catId, total] of Object.entries(categoriasTotales)) {
            await client.query(
                'UPDATE liquidacion_categoria SET total = $1 WHERE liquidacion_id = $2 AND categoria_id = $3',
                [redondear(total), id, catId]
            );
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Borrador guardado correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const finalizarLiquidacion = async (req, res) => {
    const { id } = req.params;

    try {
        const liqRes = await pool.query('SELECT estado FROM liquidacion WHERE id = $1 AND eliminado = FALSE', [id]);
        if (liqRes.rows.length === 0) {
            return res.status(400).json({ error: 'La liquidación no existe.' });
        }
        if (liqRes.rows[0].estado !== 'BORRADOR') {
            return res.status(400).json({ error: 'La liquidación ya está finalizada.' });
        }

        const pendientesRes = await pool.query(
            'SELECT COUNT(*)::int AS cantidad FROM liquidacion_item WHERE liquidacion_id = $1 AND activo = TRUE AND resultado IS NULL',
            [id]
        );
        if (pendientesRes.rows[0].cantidad > 0) {
            return res.status(400).json({ error: 'Hay items activos sin resultado calculado. Guarde el borrador antes de finalizar.' });
        }

        // AHORA ESTAMPAMOS LA FECHA DE PAGO AL FINALIZAR
        await pool.query(
            "UPDATE liquidacion SET estado = 'FINALIZADA', fecha_pago_aportes = CURRENT_DATE WHERE id = $1 AND estado = 'BORRADOR'",
            [id]
        );

        res.json({ mensaje: 'Liquidación finalizada correctamente. El registro ha sido congelado.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al finalizar la liquidación.' });
    }
};

const copiarConfiguracion = async (req, res) => {
    const { id: id_destino } = req.params;
    const { liquidacion_origen_id } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const liqDestino = await client.query('SELECT estado FROM liquidacion WHERE id = $1', [id_destino]);
        if (liqDestino.rows[0].estado !== 'BORRADOR') {
            throw new Error('No se puede modificar una liquidación finalizada.');
        }

        const origenRes = await client.query(
            'SELECT item_id, activo, porcentaje FROM liquidacion_item WHERE liquidacion_id = $1',
            [liquidacion_origen_id]
        );

        for (const itemOrigen of origenRes.rows) {
            await client.query(
                `UPDATE liquidacion_item 
                 SET activo = $1, 
                     porcentaje = (CASE WHEN tipo = 'PORCENTAJE' THEN $2 ELSE porcentaje END)
                 WHERE liquidacion_id = $3 AND item_id = $4`,
                [itemOrigen.activo, itemOrigen.porcentaje, id_destino, itemOrigen.item_id]
            );
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Configuración copiada exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const reabrirLiquidacion = async (req, res) => {
    try {
        await pool.query("UPDATE liquidacion SET estado = 'BORRADOR' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Liquidación reabierta con éxito.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al reabrir la liquidación' });
    }
};
// Recuerda exportarla

module.exports = {
    crearLiquidacion,
    getLiquidacion,
    actualizarBorrador,
    finalizarLiquidacion,
    copiarConfiguracion,
    reabrirLiquidacion
};