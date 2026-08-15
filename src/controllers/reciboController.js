const pool = require('../config/db');

const mesesAbrev = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const getDatosRecibo = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Obtener datos básicos de la liquidación "congelada" y el empleado
        const liqRes = await pool.query(`
            SELECT 
                l.id AS liquidacion_id, l.mes, l.anio, l.estado, l.categoria_laboral, l.banco, l.fecha_pago_aportes,
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

        // 2. Obtener los items calculados (trayendo los nuevos campos de impresión)
        const itemsRes = await pool.query(`
            SELECT nombre, token, tipo, naturaleza, formula, porcentaje, valor_ingresado, unidad_imprimible, base_imprimible
            FROM liquidacion_item
            WHERE liquidacion_id = $1 AND activo = TRUE
            ORDER BY id ASC
        `, [id]);

        // 3. Obtener los totales por categoría para el gráfico
        const catRes = await pool.query(`
            SELECT nombre, total
            FROM liquidacion_categoria
            WHERE liquidacion_id = $1
        `, [id]);

        // 4. Estructurar conceptos en los nuevos grupos
        const conceptos = itemsRes.rows;
        const haberes = conceptos.filter(i => i.naturaleza === 'SUMA');
        const no_remunerativos = conceptos.filter(i => i.naturaleza === 'NO_REMUNERATIVO');
        const retenciones = conceptos.filter(i => i.naturaleza === 'RESTA');
        const informativos = conceptos.filter(i => i.naturaleza === 'INFORMATIVO');

        const totalHaberes = haberes.reduce((acc, curr) => acc + parseFloat(curr.valor_ingresado || 0), 0);
        const totalNoRemunerativos = no_remunerativos.reduce((acc, curr) => acc + parseFloat(curr.valor_ingresado || 0), 0);
        const totalRetenciones = retenciones.reduce((acc, curr) => acc + parseFloat(curr.valor_ingresado || 0), 0);
        
        // Nueva lógica matemática: (Remunerativos + No Remunerativos) - Descuentos
        const sueldoNeto = (totalHaberes + totalNoRemunerativos) - totalRetenciones;

        // 5. Formateo de fechas para el PDF
        // Formato abr-26
        const periodoFormateado = `${mesesAbrev[recibo.mes - 1]}-${String(recibo.anio).slice(-2)}`;
        
        // Fecha actual para mostrar el mes de emisión real
        const fechaActual = new Date();
        const mesActualFormateado = `${String(fechaActual.getMonth() + 1).padStart(2, '0')}/${fechaActual.getFullYear()}`;

        // Devolver la estructura final al frontend
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
                sueldo_basico: recibo.sueldo_basico
            },
            liquidacion: {
                periodo: periodoFormateado,
                mes_anio_impresion: mesActualFormateado,
                estado: recibo.estado,
                categoria_laboral: recibo.categoria_laboral || '-',
                banco: recibo.banco || '-',
                fecha_pago_aportes: recibo.fecha_pago_aportes ? recibo.fecha_pago_aportes.toISOString().split('T')[0] : 'Pendiente'
            },
            detalle: {
                haberes,
                no_remunerativos,
                retenciones,
                informativos
            },
            totales: {
                bruto: totalHaberes,
                no_remunerativo: totalNoRemunerativos,
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