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

        // --- DICCIONARIO DE CONTEXTO ---
        // Creamos un mapa token -> valor para poder traducir textos como "DIAS_TRAB" o "SB"
        const contexto = {};
        itemsRes.rows.forEach(item => {
            // Si es manual, vale su valor ingresado; si no, su resultado calculado
            const val = item.tipo === 'MANUAL' ? parseFloat(item.valor_ingresado || 0) : parseFloat(item.resultado || 0);
            contexto[item.token] = val;
        });

        // Función para resolver tokens escritos en las configuraciones visuales
        const resolverTextoImprimible = (texto) => {
            if (!texto) return '-';
            const tokenLimpio = texto.trim().toUpperCase();
            // Si el texto coincide exactamente con un token existente, devolvemos su valor formateado
            if (contexto[tokenLimpio] !== undefined) {
                const val = contexto[tokenLimpio];
                // Si es un número entero (como los días), lo mostramos sin decimales extra, si tiene centavos con formato monetario
                return Number.isInteger(val) ? val.toString() : `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            return texto; // Si es texto plano (ej: "30" o "11%"), lo devuelve tal cual
        };

        // Procesamos los ítems aplicando la resolución de tokens en unidad y base
        const conceptosProcesados = itemsRes.rows.map(item => ({
            ...item,
            unidad_imprimible: resolverTextoImprimible(item.unidad_imprimible),
            base_imprimible: resolverTextoImprimible(item.base_imprimible)
        }));

        // Función auxiliar para obtener el monto real (resultado calculado o valor ingresado)
        const getMontoItem = (item) => {
            const valResultado = parseFloat(item.resultado);
            if (!isNaN(valResultado) && valResultado !== 0) return valResultado;
            return parseFloat(item.valor_ingresado || 0);
        };

        // 4. Estructurar conceptos en los nuevos grupos
        const conceptosProcesados = itemsRes.rows.map(item => ({
            ...item,
            monto_real: getMontoItem(item), // <-- Guardamos el monto real calculado
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