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