const pool = require('../config/db');

const crearLiquidacion = async (req, res) => {
    const { empleado_id, anio, mes } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validar la Regla 19: Solo una liquidación activa por empleado/período
        const existe = await client.query(
            'SELECT id FROM liquidacion WHERE empleado_id = $1 AND anio = $2 AND mes = $3 AND eliminado = FALSE',
            [empleado_id, anio, mes]
        );

        if (existe.rows.length > 0) {
            // Si ya existe, devolvemos el ID para que el frontend la abra en lugar de crear una nueva
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'La liquidación ya existe para este período.',
                liquidacion_id: existe.rows[0].id
            });
        }

        // 2. Crear la Liquidación en estado BORRADOR
        const liqRes = await client.query(
            'INSERT INTO liquidacion (empleado_id, anio, mes, estado) VALUES ($1, $2, $3, $4) RETURNING id',
            [empleado_id, anio, mes, 'BORRADOR']
        );
        const liquidacion_id = liqRes.rows[0].id;

        // 3. Generar el Snapshot de TODOS los Items globales (Regla 12)
        const itemsGlobales = await client.query('SELECT * FROM item WHERE eliminado = FALSE');

        for (const item of itemsGlobales.rows) {
            await client.query(
                `INSERT INTO liquidacion_item 
                (liquidacion_id, item_id, activo, nombre, token, tipo, naturaleza, formula, porcentaje) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    liquidacion_id,
                    item.id,
                    true, // Por defecto inician activos (se pueden desactivar en la interfaz)
                    item.nombre,
                    item.token,
                    item.tipo,
                    item.naturaleza,
                    item.formula,
                    item.porcentaje
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
        console.error(error);
        res.status(500).json({ error: 'Error al inicializar la liquidación.' });
    } finally {
        client.release();
    }
};

const getLiquidacion = async (req, res) => {
    const { id } = req.params;

    try {
        // Obtener datos principales de la liquidación
        const liqRes = await pool.query('SELECT * FROM liquidacion WHERE id = $1 AND eliminado = FALSE', [id]);
        if (liqRes.rows.length === 0) return res.status(404).json({ error: 'Liquidación no encontrada.' });

        // Obtener los items congelados (snapshot)
        const itemsRes = await pool.query('SELECT * FROM liquidacion_item WHERE liquidacion_id = $1 ORDER BY id', [id]);

        // Obtener las categorías congeladas (snapshot)
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

        // 1. Validar que la liquidación sigue en BORRADOR
        const liqRes = await client.query('SELECT estado FROM liquidacion WHERE id = $1', [id]);
        if (liqRes.rows[0].estado !== 'BORRADOR') {
            throw new Error('No se puede modificar una liquidación finalizada.');
        }

        // 2. Actualizar los valores en liquidacion_item
        for (const item of items) {
            await client.query(
                `UPDATE liquidacion_item 
                 SET activo = $1, valor_ingresado = $2, porcentaje = $3, resultado = $4 
                 WHERE id = $5 AND liquidacion_id = $6`,
                [
                    item.activo,
                    item.tipo === 'MANUAL' ? (item.valor_ingresado || null) : null,
                    item.tipo === 'PORCENTAJE' ? (item.porcentaje || null) : null,
                    resultados[item.id] || 0,
                    item.id,
                    id
                ]
            );
        }

        // 3. Procesar y guardar los totales de Categorías (Feature nueva de Gráficos)
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

        // ¡AQUÍ ESTABA EL ERROR CORREGIDO! (uso de "of")
        for (const [catId, total] of Object.entries(categoriasTotales)) {
            await client.query(
                'UPDATE liquidacion_categoria SET total = $1 WHERE liquidacion_id = $2 AND categoria_id = $3',
                [total, id, catId]
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

// Asegúrate de que el module.exports al final del archivo luzca así:
// module.exports = { crearLiquidacion, getLiquidacion, actualizarBorrador };
module.exports = { crearLiquidacion, getLiquidacion };