const pool = require('../config/db');

const mesesAbrev = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const getDatosRecibo = async (req, res) => {
    const { id } = req.params;

    try {
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

        const itemsRes = await pool.query(`
            SELECT nombre, token, tipo, naturaleza, formula, porcentaje, valor_ingresado, unidad_imprimible, base_imprimible, resultado
            FROM liquidacion_item
            WHERE liquidacion_id = $1 AND activo = TRUE
            ORDER BY id ASC
        `, [id]);

        const catRes = await pool.query(`
            SELECT nombre, total
            FROM liquidacion_categoria
            WHERE liquidacion_id = $1
        `, [id]);

        // --- 1. CALCULAR ANTIGÜEDAD PARA EL CONTEXTO ---
        let aniosAntiguedad = 0;
        if (recibo.fecha_ingreso) {
            const ingreso = new Date(recibo.fecha_ingreso);
            aniosAntiguedad = recibo.anio - ingreso.getFullYear();
            if (recibo.mes < ingreso.getMonth() + 1) {
                aniosAntiguedad--;
            }
            aniosAntiguedad = Math.max(0, aniosAntiguedad);
        }

        // --- 2. CALCULAR TOTALES GLOBALES PARA EL CONTEXTO ---
        let sumRem = 0;
        let sumNoRem = 0;
        let sumDesc = 0;

        itemsRes.rows.forEach(item => {
            const val = item.tipo === 'MANUAL' ? parseFloat(item.valor_ingresado || 0) : parseFloat(item.resultado || 0);
            if (item.naturaleza === 'SUMA') sumRem += val;
            if (item.naturaleza === 'NO_REMUNERATIVO') sumNoRem += val;
            if (item.naturaleza === 'RESTA') sumDesc += val;
        });

        // --- 3. DICCIONARIO DE CONTEXTO ---
        const contexto = {};
        
        // Inyectamos las variables globales primero
        contexto['ANIOS_ANTIGUEDAD'] = aniosAntiguedad;
        contexto['TOTAL_REMUNERATIVO'] = sumRem;
        contexto['TOTAL_NO_REM'] = sumNoRem;
        contexto['TOTAL_BRUTO'] = sumRem + sumNoRem;
        contexto['TOTAL_DESCUENTOS'] = sumDesc;
        contexto['TOTAL_NETO'] = (sumRem + sumNoRem) - sumDesc;

        // Inyectamos los tokens de los ítems de la BD
        itemsRes.rows.forEach(item => {
            const val = item.tipo === 'MANUAL' ? parseFloat(item.valor_ingresado || 0) : parseFloat(item.resultado || 0);
            contexto[item.token] = val;
        });

        // Función para resolver tokens escritos en las configuraciones visuales
        // Mapeamos los ítems
const conceptosProcesados = itemsRes.rows.map(item => {
    let unidadFinal = item.unidad_imprimible;
    let baseFinal = item.base_imprimible;

    // MAGIA 1: Auto-relleno de Unidad y Base para Porcentajes
    if (item.tipo === 'PORCENTAJE') {
        if (!unidadFinal) unidadFinal = `${item.porcentaje}%`;
        
        // Si la base está vacía y usa un token global o un ítem, buscamos su valor
        if (!baseFinal && item.base_token && contexto[item.base_token] !== undefined) {
            baseFinal = contexto[item.base_token];
        }
    }

    // Función interna para traducir cualquier token (incluyendo TOTAL_REMUNERATIVO) a dinero/número
    const traducir = (texto) => {
        if (!texto) return '-';
        const txt = texto.toString().trim().toUpperCase();
        // Si el texto es exactamente un token existente en el contexto
        if (contexto[txt] !== undefined) {
            const val = contexto[txt];
            return Number.isInteger(val) ? val.toString() : `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return texto;
    };

    return {
        ...item,
        monto_real: getMontoItem(item),
        unidad_imprimible: traducir(unidadFinal),
        base_imprimible: traducir(baseFinal)
    };
});

        const getMontoItem = (item) => {
            const valResultado = parseFloat(item.resultado);
            if (!isNaN(valResultado) && valResultado !== 0) return valResultado;
            return parseFloat(item.valor_ingresado || 0);
        };

        const conceptosProcesados = itemsRes.rows.map(item => ({
            ...item,
            monto_real: getMontoItem(item),
            unidad_imprimible: resolverTextoImprimible(item.unidad_imprimible),
            base_imprimible: resolverTextoImprimible(item.base_imprimible)
        }));

        const haberes = conceptosProcesados.filter(i => i.naturaleza === 'SUMA');
        const no_remunerativos = conceptosProcesados.filter(i => i.naturaleza === 'NO_REMUNERATIVO');
        const retenciones = conceptosProcesados.filter(i => i.naturaleza === 'RESTA');
        const informativos = conceptosProcesados.filter(i => i.naturaleza === 'INFORMATIVO');

        const totalHaberes = haberes.reduce((acc, curr) => acc + curr.monto_real, 0);
        const totalNoRemunerativos = no_remunerativos.reduce((acc, curr) => acc + curr.monto_real, 0);
        const totalRetenciones = retenciones.reduce((acc, curr) => acc + curr.monto_real, 0);
        
        const sueldoNeto = (totalHaberes + totalNoRemunerativos) - totalRetenciones;

        const periodoFormateado = `${mesesAbrev[recibo.mes - 1]}-${String(recibo.anio).slice(-2)}`;
        const fechaActual = new Date();
        const mesActualFormateado = `${String(fechaActual.getMonth() + 1).padStart(2, '0')}/${fechaActual.getFullYear()}`;

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