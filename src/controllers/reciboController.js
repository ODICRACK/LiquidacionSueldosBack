const pool = require('../config/db');

const getDatosRecibo = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Obtener datos básicos: liquidación, empleado y cliente
        // CORRECCIÓN: Quitamos l.sueldo_bruto y agregamos e.sueldo_basico
        const liqRes = await pool.query(`
            SELECT 
                l.id AS liquidacion_id, l.mes, l.anio, l.estado,
                e.nombre, e.apellido, e.cuil, e.nro_legajo, e.fecha_ingreso, e.sueldo_basico,
                c.razon_social, c.cuit, c.domicilio_laboral
            FROM liquidacion l
            JOIN empleado e ON l.empleado_id = e.id
            JOIN cliente c ON e.cliente_id = c.id
            WHERE l.id = $1
        `, [id]);

        if (liqRes.rows.length === 0) {
            return res.status(404).json({ error: 'Liquidación no encontrada' });
        }

        const recibo = liqRes.rows[0];

        // 2. Obtener los items calculados (la "fotografía" histórica)
        const itemsRes = await pool.query(`
            SELECT nombre, token, tipo, naturaleza, formula, porcentaje, valor_ingresado
            FROM liquidacion_item
            WHERE liquidacion_id = $1 AND activo = TRUE
            ORDER BY id ASC
        `, [id]);

        // 3. Obtener los totales por categoría para inyectar al gráfico
        const catRes = await pool.query(`
            SELECT nombre, total
            FROM liquidacion_categoria
            WHERE liquidacion_id = $1
        `, [id]);

        // 4. Estructurar conceptos (Haberes vs Retenciones)
        const conceptos = itemsRes.rows;
        const haberes = conceptos.filter(i => i.naturaleza === 'SUMA');
        const retenciones = conceptos.filter(i => i.naturaleza === 'RESTA');
        const informativos = conceptos.filter(i => i.naturaleza === 'INFORMATIVO');

        const totalHaberes = haberes.reduce((acc, curr) => acc + parseFloat(curr.valor_ingresado || 0), 0);
        const totalRetenciones = retenciones.reduce((acc, curr) => acc + parseFloat(curr.valor_ingresado || 0), 0);
        const sueldoNeto = totalHaberes - totalRetenciones;

        // 5. Devolver la estructura final
        res.json({
            empresa: {
                razon_social: recibo.razon_social,
                cuit: recibo.cuit,
                domicilio: recibo.domicilio_laboral
            },
            empleado: {
                nombre_completo: `${recibo.apellido}, ${recibo.nombre}`,
                cuil: recibo.cuil,
                legajo: recibo.nro_legajo,
                fecha_ingreso: recibo.fecha_ingreso,
                sueldo_basico: recibo.sueldo_basico // CORRECCIÓN: Mapeamos sueldo_basico
            },
            liquidacion: {
                periodo: `${String(recibo.mes).padStart(2, '0')}/${recibo.anio}`,
                estado: recibo.estado
            },
            detalle: {
                haberes,
                retenciones,
                informativos
            },
            totales: {
                bruto: totalHaberes,
                descuentos: totalRetenciones,
                neto: sueldoNeto
            },
            grafico: catRes.rows
        });

    } catch (error) {
        console.error('Error al obtener datos del recibo:', error);
        res.status(500).json({ error: 'Error al generar los datos del recibo' });
    }
};

module.exports = { getDatosRecibo };