const pool = require('../config/db');
const puppeteer = require('puppeteer');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const pattern = require('patternomaly');

// Configuración del renderizador de gráficos (ancho y alto)
const width = 400;
const height = 400;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

const generarReciboPDF = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Obtener datos (Simplificado para el ejemplo, deberías hacer los JOINs necesarios con empleado y cliente)
        const liqRes = await pool.query('SELECT * FROM liquidacion WHERE id = $1', [id]);
        const itemsRes = await pool.query('SELECT * FROM liquidacion_item WHERE liquidacion_id = $1 AND activo = TRUE', [id]);
        const catRes = await pool.query('SELECT * FROM liquidacion_categoria WHERE liquidacion_id = $1', [id]);
        
        if (liqRes.rows.length === 0) return res.status(404).json({ error: 'Liquidación no encontrada' });

        const liquidacion = liqRes.rows[0];
        const items = itemsRes.rows;
        const categorias = catRes.rows.filter(c => parseFloat(c.total) > 0);

        // 2. Generar el Gráfico de Torta en B/N (Base64)
        const labels = categorias.map(c => c.nombre);
        const data = categorias.map(c => parseFloat(c.total));
        
        // Generar patrones monocromáticos para cada porción
        const backgroundColors = pattern.generate(
            ['diagonal', 'cross', 'dash', 'dot-dash', 'dot', 'zigzag'], 
            '#000000', // Color del patrón (negro)
            '#ffffff'  // Color de fondo (blanco)
        );

        const configuration = {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: backgroundColors,
                    borderColor: '#000',
                    borderWidth: 1
                }]
            },
            options: {
                plugins: {
                    legend: { position: 'right' }
                }
            }
        };

        const imageBase64 = await chartJSNodeCanvas.renderToDataURL(configuration);

        // 3. Organizar Items por Naturaleza
        const sumas = items.filter(i => i.naturaleza === 'SUMA');
        const restas = items.filter(i => i.naturaleza === 'RESTA');
        const informativos = items.filter(i => i.naturaleza === 'INFORMATIVO');

        const totalSuma = sumas.reduce((acc, i) => acc + parseFloat(i.resultado), 0);
        const totalResta = restas.reduce((acc, i) => acc + parseFloat(i.resultado), 0);
        const sueldoNeto = totalSuma - totalResta;

        // 4. Construir el HTML (Estructura base referenciada en tu imagen)
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 20px; }
                .header-empresa { border-bottom: 2px solid #000; margin-bottom: 10px; padding-bottom: 5px; }
                .header-empresa h1 { font-size: 14px; margin: 0; text-transform: uppercase; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                th, td { border: 1px solid #000; padding: 4px; text-align: right; }
                th { background-color: #f0f0f0; text-align: center; font-weight: bold; }
                .col-izq { text-align: left; }
                .seccion-titulo { background-color: #d9d9d9; font-weight: bold; text-align: center; padding: 4px; border: 1px solid #000; }
                .totales-footer { margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
                .grafico-container { width: 300px; text-align: center; }
                .grafico-container img { width: 100%; height: auto; }
                .firma { border-top: 1px dashed #000; width: 200px; text-align: center; margin-top: 50px; float: right; }
            </style>
        </head>
        <body>
            <div class="header-empresa">
                <h1>Don Mariano Constructora S.R.L.</h1>
                <p>C.U.I.T.: 30-00000000-0</p>
                <p>Liquidación de Haberes - Período: ${liquidacion.mes}/${liquidacion.anio}</p>
            </div>

            <!-- Aquí irían los datos del empleado según la referencia (Legajo, Fecha Ingreso, etc.) -->

            <div class="seccion-titulo">SUELDO BRUTO / REMUNERATIVOS</div>
            <table>
                <tr><th class="col-izq">Concepto</th><th>Unidad</th><th>Monto</th></tr>
                ${sumas.map(i => `<tr><td class="col-izq">${i.nombre}</td><td>${i.porcentaje ? i.porcentaje + '%' : (i.valor_ingresado || '')}</td><td>$${parseFloat(i.resultado).toFixed(2)}</td></tr>`).join('')}
            </table>

            <div class="seccion-titulo">DESCUENTOS</div>
            <table>
                <tr><th class="col-izq">Concepto</th><th>Unidad</th><th>Monto</th></tr>
                ${restas.map(i => `<tr><td class="col-izq">${i.nombre}</td><td>${i.porcentaje ? i.porcentaje + '%' : (i.valor_ingresado || '')}</td><td>$${parseFloat(i.resultado).toFixed(2)}</td></tr>`).join('')}
            </table>

            <div class="seccion-titulo">INFORMATIVOS</div>
            <table>
                ${informativos.map(i => `<tr><td class="col-izq">${i.nombre}</td><td>$${parseFloat(i.resultado).toFixed(2)}</td></tr>`).join('')}
            </table>

            <table style="margin-top: 10px; font-weight: bold; font-size: 12px;">
                <tr>
                    <td class="col-izq">SUELDO NETO A COBRAR:</td>
                    <td>$${sueldoNeto.toFixed(2)}</td>
                </tr>
            </table>

            <div class="totales-footer">
                <div style="width: 50%;">
                    <h3>Composición de Costos</h3>
                    <!-- Aquí puedes iterar las categorías en formato tabla como en la parte inferior izquierda de la imagen -->
                    <table style="width: 90%;">
                        ${categorias.map(c => `<tr><td class="col-izq">${c.nombre}</td><td>$${parseFloat(c.total).toFixed(2)}</td></tr>`).join('')}
                    </table>
                </div>
                <div class="grafico-container">
                    <strong>Costo Total Empleador</strong><br/>
                    <img src="${imageBase64}" />
                </div>
            </div>

            <div class="firma">Firma del Empleado</div>
        </body>
        </html>
        `;

        // 5. Generar PDF con Puppeteer
        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necesario en entornos como Render
            headless: 'new'
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({ 
            format: 'A4', 
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });

        await browser.close();

        // 6. Devolver el PDF al Frontend
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
            'Content-Disposition': `inline; filename="recibo_${liquidacion.mes}_${liquidacion.anio}.pdf"`
        });
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando PDF:", error);
        res.status(500).json({ error: 'Error al generar el recibo PDF' });
    }
};

module.exports = { generarReciboPDF };