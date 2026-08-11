require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Registro de todas las rutas del sistema
app.use('/api/auth', require('./routes/auth'));
app.use('/api/entidades', require('./routes/entidades'));
app.use('/api/items', require('./routes/items'));
app.use('/api/categorias', require('./routes/categorias'));
app.use('/api/liquidaciones', require('./routes/liquidaciones'));

// Ruta de prueba de salud para Render
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', mensaje: 'Servidor funcionando correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor inicializado en el puerto ${PORT}`);
});