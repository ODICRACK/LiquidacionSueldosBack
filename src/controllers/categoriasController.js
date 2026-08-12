const pool = require('../config/db');

// Lista todas las categorías, incluyendo las dadas de baja (el frontend las agrupa).
const getCategorias = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categoria ORDER BY nombre');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener categorías.' });
    }
};

const createCategoria = async (req, res) => {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });

    try {
        const result = await pool.query('INSERT INTO categoria (nombre) VALUES ($1) RETURNING id', [nombre]);
        res.json({ id: result.rows[0].id, mensaje: 'Categoría creada exitosamente.' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al crear la categoría.' });
    }
};

const updateCategoria = async (req, res) => {
    const { id } = req.params;
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });

    try {
        const result = await pool.query('UPDATE categoria SET nombre = $1 WHERE id = $2 RETURNING id', [nombre, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada.' });
        res.json({ mensaje: 'Categoría actualizada exitosamente.' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar la categoría.' });
    }
};

// Baja lógica. Los snapshots históricos (liquidacion_categoria) conservan su nombre.
const bajaCategoria = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('UPDATE categoria SET eliminado = TRUE WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada.' });
        res.json({ mensaje: 'Categoría dada de baja.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al dar de baja la categoría.' });
    }
};
const reactivarCategoria = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('UPDATE categoria SET eliminado = FALSE WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada.' });
        res.json({ mensaje: 'Categoría reactivada exitosamente.' });
    } catch (error) {
        // 23505 es el código de error de PostgreSQL para violación de índice único
        if (error.code === '23505') {
            return res.status(400).json({ error: 'No se puede reactivar porque ya creaste otra categoría activa con el mismo nombre.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al reactivar la categoría.' });
    }
};

// Recuerda actualizar tu exportación para incluirla:
module.exports = { getCategorias, createCategoria, updateCategoria, bajaCategoria, reactivarCategoria };
