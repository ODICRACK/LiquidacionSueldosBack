const pool = require('../config/db');
const { detectarCiclo, extraerTokens } = require('../utils/formulaValidator');

const createItem = async (req, res) => {
    const { nombre, token, tipo, naturaleza, formula, porcentaje, categorias } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validar que el token no exista (ignorando eliminados)
        const existe = await client.query('SELECT id FROM item WHERE token = $1 AND eliminado = FALSE', [token]);
        if (existe.rows.length > 0) throw new Error(`El token ${token} ya existe.`);

        // 2. Si es fórmula, validar dependencias circulares
        if (tipo === 'FORMULA') {
            const itemsRes = await client.query('SELECT token, tipo, formula FROM item WHERE eliminado = FALSE');
            const itemsExistentes = itemsRes.rows;
            
            // Validar que los tokens usados en la fórmula realmente existan
            const tokensUsados = extraerTokens(formula);
            const tokensValidos = itemsExistentes.map(i => i.token);
            const tokensInexistentes = tokensUsados.filter(t => !tokensValidos.includes(t));
            
            if (tokensInexistentes.length > 0) {
                throw new Error(`La fórmula contiene tokens inexistentes: ${tokensInexistentes.join(', ')}`);
            }

            // Validar ciclos
            if (detectarCiclo(token, formula, itemsExistentes)) {
                throw new Error('La fórmula genera una dependencia circular.');
            }
        }

        // 3. Insertar Item
        const itemRes = await client.query(
            `INSERT INTO item (nombre, token, tipo, naturaleza, formula, porcentaje) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [nombre, token, tipo, naturaleza, formula || null, porcentaje || null]
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

        // Verificar si es dependencia de alguna fórmula activa
        const formulasRes = await pool.query('SELECT token, formula FROM item WHERE tipo = $2 AND eliminado = FALSE', [id, 'FORMULA']);
        
        for (const item of formulasRes.rows) {
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