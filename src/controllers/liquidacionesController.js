const pool = require('../config/db');
const { redondear } = require('../utils/mathEngine');
const { validarMes, validarAnio } = require('../utils/validators');

const crearLiquidacion = async (req, res) => {
    const { empleado_id, anio, mes } = req.body;

    try {
        validarAnio(anio);
        validarMes(mes);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 0. Un empleado dado de baja no puede iniciar nuevas liquidaciones
        // AHORA TAMBIÉN TRAEMOS categoria_laboral Y banco
        const empRes = await client.query('SELECT id, eliminado, sueldo_basico, categoria_laboral, banco FROM empleado WHERE id = $1', [empleado_id]);
        if (empRes.rows.length === 0 || empRes.rows[0].eliminado) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No se puede iniciar una liquidación para un empleado dado de baja.' });
        }
        const sueldoBasico = parseFloat(empRes.rows[0].sueldo_basico) || 0;
        const catLaboral = empRes.rows[0].categoria_laboral || null;
        const bancoEmp = empRes.rows[0].banco || null;

        // 1. Validar la Regla 19: Solo una liquidación activa por empleado/período
        const existe = await client.query(
            'SELECT id FROM liquidacion WHERE empleado_id = $1 AND anio = $2 AND mes = $3 AND eliminado = FALSE',
            [empleado_id, anio, mes]
        );

        if (existe.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'La liquidación ya existe para este período.',
                liquidacion_id: existe.rows[0].id
            });
        }

        // 2. Crear la Liquidación en estado BORRADOR (Fotografiando categoría y banco)
        const liqRes = await client.query(
            'INSERT INTO liquidacion (empleado_id, anio, mes, estado, categoria_laboral, banco) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [empleado_id, anio, mes, 'BORRADOR', catLaboral, bancoEmp]
        );
        const liquidacion_id = liqRes.rows[0].id;

        // 3. Generar el Snapshot de TODOS los Items globales (Regla 12)
        const itemsGlobales = await client.query('SELECT * FROM item WHERE eliminado = FALSE');

        for (const item of itemsGlobales.rows) {
            await client.query(
                `INSERT INTO liquidacion_item 
                (liquidacion_id, item_id, activo, nombre, token, tipo, naturaleza, formula, porcentaje, base_token, valor_ingresado, unidad_imprimible, base_imprimible) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    liquidacion_id,
                    item.id,
                    true,
                    item.nombre,
                    item.token,
                    item.tipo,
                    item.naturaleza,
                    item.formula,
                    item.porcentaje,
                    item.base_token,
                    item.token === 'SB' ? sueldoBasico : null,
                    item.unidad_imprimible,
                    item.base_imprimible
                ]
            );
        }

        // 4. Generar el Snapshot de Categorías para el Gráfico
        const categoriasGlobales = await client.query('SELECT * FROM categoria WHERE eliminado = FALSE');

        for (const cat of categoriasGlobales.rows) {
            await client.query(
                'INSERT INTO liquidacion_categoria (liquidacion_id, categoria_id, nombre, total) VALUES ($1, $2, $3, $4)',
                [liquidacion_id, cat.id, cat.nombre, 0.00]
            );
        }

        await client.query('COMMIT');
        res.json({ liquidacion_id, mensaje: 'Liquidación inicializada correctamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            const existente = await client.query(
                'SELECT id FROM liquidacion WHERE empleado_id = $1 AND anio = $2 AND mes = $3 AND eliminado = FALSE',
                [empleado_id, anio, mes]
            );
            return res.status(409).json({
                error: 'La liquidación ya existe para este período.',
                liquidacion_id: existente.rows[0]?.id
            });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al inicializar la liquidación.' });
    } finally {
        client.release();
    }
};

const getLiquidacion = async (req, res) => {
    const { id } = req.params;

    try {
        const liqRes = await pool.query('SELECT * FROM liquidacion WHERE id = $1 AND eliminado = FALSE', [id]);
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

module.exports = { 
    crearLiquidacion, 
    getLiquidacion, 
    actualizarBorrador, 
    finalizarLiquidacion, 
    copiarConfiguracion 
};