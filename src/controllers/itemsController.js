const pool = require('../config/db');
const { detectarCiclo, extraerTokens, validarFormulaChars } = require('../utils/formulaValidator');
const { validarToken, validarOpcion } = require('../utils/validators');

const TIPOS = ['PORCENTAJE', 'FORMULA', 'MANUAL'];
// AGREGAMOS LA NUEVA NATURALEZA
const NATURALEZAS = ['SUMA', 'RESTA', 'INFORMATIVO', 'AUXILIAR', 'NO_REMUNERATIVO'];
const TOKENS_GLOBALES = ['TOTAL_REMUNERATIVO', 'TOTAL_NO_REM', 'TOTAL_BRUTO', 'TOTAL_DESCUENTOS', 'TOTAL_NETO', "ANIOS_ANTIGUEDAD"];

const validarDependencias = async (client, token, tipo, formula, base_token, idExcluido) => {
    const itemsRes = idExcluido
        ? await client.query('SELECT token, tipo, formula, base_token FROM item WHERE eliminado = FALSE AND id != $1', [idExcluido])
        : await client.query('SELECT token, tipo, formula, base_token FROM item WHERE eliminado = FALSE');
    const itemsExistentes = itemsRes.rows;
    const tokensValidos = itemsExistentes.map(i => i.token);

    if (tipo === 'FORMULA') {
        validarFormulaChars(formula);
        const tokensUsados = extraerTokens(formula);
        
        // EXCEPCIÓN: Filtramos los tokens inexistentes, PERO perdonamos a los TOKENS_GLOBALES
        const tokensInexistentes = tokensUsados.filter(t => !tokensValidos.includes(t) && !TOKENS_GLOBALES.includes(t));
        
        if (tokensInexistentes.length > 0) {
            throw new Error(`La fórmula contiene tokens inexistentes: ${tokensInexistentes.join(', ')}`);
        }
        if (detectarCiclo(token, { formula }, itemsExistentes)) {
            throw new Error('La fórmula genera una dependencia circular.');
        }
    }

    if (tipo === 'PORCENTAJE') {
        if (!base_token) throw new Error('Un item PORCENTAJE requiere un item base (base_token).');
        if (base_token === token) throw new Error('La base no puede ser el propio item.');
        
        // EXCEPCIÓN: Permitimos que la base sea un token normal o uno de los globales
        if (!tokensValidos.includes(base_token) && !TOKENS_GLOBALES.includes(base_token)) {
            throw new Error(`La base "${base_token}" no existe entre los items activos.`);
        }
        if (detectarCiclo(token, { base_token }, itemsExistentes)) {
            throw new Error('La base genera una dependencia circular.');
        }
    }

    return itemsExistentes;
};

const getItems = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM item WHERE eliminado = FALSE ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener items' });
    }
};

const getItemById = async (req, res) => {
    const { id } = req.params;
    try {
        const itemRes = await pool.query('SELECT * FROM item WHERE id = $1', [id]);
        if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Item no encontrado.' });

        const catsRes = await pool.query(
            'SELECT ic.categoria_id, ic.operacion, c.nombre FROM item_categoria ic JOIN categoria c ON c.id = ic.categoria_id WHERE ic.item_id = $1',
            [id]
        );

        res.json({ ...itemRes.rows[0], categorias: catsRes.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener el item.' });
    }
};

const createItem = async (req, res) => {
    // AÑADIMOS LA VARIABLE ORDEN
    const { nombre, token, tipo, naturaleza, formula, porcentaje, base_token, categorias, unidad_imprimible, base_imprimible, orden } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        validarRequeridoNombre(nombre);
        validarToken(token);
        validarOpcion(tipo, TIPOS, 'tipo');
        validarOpcion(naturaleza, NATURALEZAS, 'naturaleza');

        const existe = await client.query('SELECT id FROM item WHERE token = $1 AND eliminado = FALSE', [token]);
        if (existe.rows.length > 0) throw new Error(`El token ${token} ya existe.`);

        await validarDependencias(client, token, tipo, formula, base_token, null);

        // AHORA GUARDAMOS EL ORDEN TAMBIÉN
        const itemRes = await client.query(
            `INSERT INTO item (nombre, token, tipo, naturaleza, formula, porcentaje, base_token, unidad_imprimible, base_imprimible, orden) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
                nombre, 
                token, 
                tipo, 
                naturaleza, 
                formula || null, 
                porcentaje || null, 
                base_token || null,
                unidad_imprimible || null,
                base_imprimible || null,
                orden || null // Inyectamos el orden aquí (si no escriben nada, viaja como null y se pone al final)
            ]
        );
        const itemId = itemRes.rows[0].id;

        await insertarCategorias(client, itemId, categorias);

        await client.query('COMMIT');
        res.json({ mensaje: 'Item creado exitosamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const updateItem = async (req, res) => {
    const { id } = req.params;
    // AÑADIMOS LA VARIABLE ORDEN
    const { nombre, token, tipo, naturaleza, formula, porcentaje, base_token, categorias, unidad_imprimible, base_imprimible, orden } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        validarRequeridoNombre(nombre);
        validarToken(token);
        validarOpcion(tipo, TIPOS, 'tipo');
        validarOpcion(naturaleza, NATURALEZAS, 'naturaleza');

        const itemActual = await client.query('SELECT * FROM item WHERE id = $1', [id]);
        if (itemActual.rows.length === 0) throw new Error('El item no existe.');
        const tokenOriginal = itemActual.rows[0].token;

        if (tokenOriginal === 'SB' && token !== 'SB') {
            throw new Error('El token del Sueldo Básico (SB) no puede modificarse.');
        }

        if (token !== tokenOriginal) {
            const existe = await client.query(
                'SELECT id FROM item WHERE token = $1 AND eliminado = FALSE AND id != $2',
                [token, id]
            );
            if (existe.rows.length > 0) throw new Error(`El token ${token} ya existe.`);

            const dependientes = await client.query(
                'SELECT token, tipo, formula, base_token FROM item WHERE eliminado = FALSE AND id != $1',
                [id]
            );
            for (const dep of dependientes.rows) {
                const tokensFormula = extraerTokens(dep.formula);
                if ((dep.tipo === 'PORCENTAJE' && dep.base_token === tokenOriginal) || tokensFormula.includes(tokenOriginal)) {
                    throw new Error(`El token no puede modificarse porque el item es utilizado por: ${dep.token}`);
                }
            }
        }

        await validarDependencias(client, token, tipo, formula, base_token, id);

        // AHORA ACTUALIZAMOS EL ORDEN TAMBIÉN
        await client.query(
            `UPDATE item 
             SET nombre = $1, token = $2, tipo = $3, naturaleza = $4, formula = $5, porcentaje = $6, 
                 base_token = $7, unidad_imprimible = $8, base_imprimible = $9, orden = $10
             WHERE id = $11`,
            [
                nombre,
                token,
                tipo,
                naturaleza,
                tipo === 'FORMULA' ? (formula || null) : null,
                tipo === 'PORCENTAJE' ? (porcentaje || null) : null,
                tipo === 'PORCENTAJE' ? (base_token || null) : null,
                unidad_imprimible || null,
                base_imprimible || null,
                orden || null, // Actualizamos el orden
                id
            ]
        );

        await client.query('DELETE FROM item_categoria WHERE item_id = $1', [id]);
        await insertarCategorias(client, id, categorias);

        await client.query('COMMIT');
        res.json({ mensaje: 'Item actualizado exitosamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const insertarCategorias = async (client, itemId, categorias) => {
    if (categorias && categorias.length > 0) {
        for (const cat of categorias) {
            await client.query(
                'INSERT INTO item_categoria (item_id, categoria_id, operacion) VALUES ($1, $2, $3)',
                [itemId, cat.id, cat.operacion]
            );
        }
    }
};

const validarRequeridoNombre = (nombre) => {
    if (!nombre || !String(nombre).trim()) throw new Error('El nombre del item es obligatorio.');
};

const deleteItem = async (req, res) => {
    const { id } = req.params;

    try {
        const itemRes = await pool.query('SELECT token FROM item WHERE id = $1', [id]);
        const tokenAEliminar = itemRes.rows[0]?.token;

        if (!tokenAEliminar) {
            return res.status(404).json({ error: 'El item no existe.' });
        }

        if (tokenAEliminar === 'SB') {
            return res.status(400).json({ error: 'El Sueldo Básico (SB) no puede eliminarse.' });
        }

        const dependenciasRes = await pool.query(
            'SELECT token, tipo, formula, base_token FROM item WHERE eliminado = FALSE AND id != $1',
            [id]
        );

        for (const item of dependenciasRes.rows) {
            if (item.tipo === 'PORCENTAJE' && item.base_token === tokenAEliminar) {
                return res.status(400).json({
                    error: `El item no puede eliminarse porque es la base del item: ${item.token}`
                });
            }
            const dependencias = extraerTokens(item.formula);
            if (dependencias.includes(tokenAEliminar)) {
                return res.status(400).json({
                    error: `El item no puede eliminarse porque es utilizado por la fórmula del item: ${item.token}`
                });
            }
        }

        await pool.query('UPDATE item SET eliminado = TRUE WHERE id = $1', [id]);
        res.json({ mensaje: 'Item eliminado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar el item.' });
    }
};

module.exports = { getItems, getItemById, createItem, updateItem, deleteItem };