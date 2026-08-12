const pool = require('../config/db');
const { detectarCiclo, extraerTokens, validarFormulaChars } = require('../utils/formulaValidator');

const createItem = async (req, res) => {
    const { nombre, token, tipo, naturaleza, formula, porcentaje, base_token, categorias } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validar que el token no exista (ignorando eliminados)
        const existe = await client.query('SELECT id FROM item WHERE token = $1 AND eliminado = FALSE', [token]);
        if (existe.rows.length > 0) throw new Error(`El token ${token} ya existe.`);

        // 2. Obtener items activos para validar dependencias
        const itemsRes = await client.query('SELECT token, tipo, formula, base_token FROM item WHERE eliminado = FALSE');
        const itemsExistentes = itemsRes.rows;
        const tokensValidos = itemsExistentes.map(i => i.token);

        if (tipo === 'FORMULA') {
            // Validar que la fórmula solo tenga caracteres permitidos
            validarFormulaChars(formula);

            // Validar que los tokens usados en la fórmula realmente existan
            const tokensUsados = extraerTokens(formula);
            const tokensInexistentes = tokensUsados.filter(t => !tokensValidos.includes(t));
            
            if (tokensInexistentes.length > 0) {
                throw new Error(`La fórmula contiene tokens inexistentes: ${tokensInexistentes.join(', ')}`);
            }

            // Validar ciclos
            if (detectarCiclo(token, { formula }, itemsExistentes)) {
                throw new Error('La fórmula genera una dependencia circular.');
            }
        }

        if (tipo === 'PORCENTAJE') {
            // El porcentaje requiere una base sobre la cual calcularse
            if (!base_token) throw new Error('Un item PORCENTAJE requiere un item base (base_token).');

            // La base no puede ser el propio item
            if (base_token === token) throw new Error('La base no puede ser el propio item.');

            // La base debe existir entre los items activos
            if (!tokensValidos.includes(base_token)) {
                throw new Error(`La base "${base_token}" no existe entre los items activos.`);
            }

            // Validar ciclos (ej: A base de B y B base de A)
            if (detectarCiclo(token, { base_token }, itemsExistentes)) {
                throw new Error('La base genera una dependencia circular.');
            }
        }

        // 3. Insertar Item
        const itemRes = await client.query(
            `INSERT INTO item (nombre, token, tipo, naturaleza, formula, porcentaje, base_token) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [nombre, token, tipo, naturaleza, formula || null, porcentaje || null, base_token || null]
        );
        const itemId = itemRes.rows[0].id;

        // 4. Insertar relaciones con Categorías
        if (categorias && categorias.length > 0) {
            for (const cat of categorias) {
                await client.query(
                    'INSERT INTO item_categoria (item_id, categoria_id, operacion) VALUES ($1, $2, $3)',
                    [itemId, cat.id, cat.operacion]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ mensaje: 'Item creado exitosamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const deleteItem = async (req, res) => {
    const { id } = req.params;
    
    try {
        const itemRes = await pool.query('SELECT token FROM item WHERE id = $1', [id]);
        const tokenAEliminar = itemRes.rows[0]?.token;

        // El Sueldo Básico (SB) es parte del núcleo del recibo: no puede eliminarse
        if (tokenAEliminar === 'SB') {
            return res.status(400).json({ error: 'El Sueldo Básico (SB) no puede eliminarse.' });
        }

        // Verificar si es dependencia de alguna fórmula o base de porcentaje activa
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

        // Soft delete
        await pool.query('UPDATE item SET eliminado = TRUE WHERE id = $1', [id]);
        res.json({ mensaje: 'Item eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar el item.' });
    }
};

module.exports = { createItem, deleteItem };