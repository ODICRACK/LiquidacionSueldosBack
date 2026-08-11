require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Importar rutas (Asegúrate de crear estos archivos en la carpeta /routes vinculando los controladores previos)
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/entidades', require('./routes/entidades'));
// app.use('/api/items', require('./routes/items'));
app.use('/api/liquidaciones', require('./routes/liquidaciones'));

// Ruta de prueba de salud para Render
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', mensaje: 'Servidor funcionando correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor inicializado en el puerto ${PORT}`);
});