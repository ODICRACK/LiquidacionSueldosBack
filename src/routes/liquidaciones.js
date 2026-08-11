const express = require('express');
const router = express.Router();
const { crearLiquidacion, getLiquidacion, actualizarBorrador, finalizarLiquidacion, copiarConfiguracion } = require('../controllers/liquidacionesController');
const { generarReciboPDF } = require('../controllers/pdfController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', crearLiquidacion);
router.get('/:id', getLiquidacion);
router.put('/:id/borrador', actualizarBorrador);
router.put('/:id/finalizar', finalizarLiquidacion);
router.post('/:id/copiar', copiarConfiguracion);
router.get('/:id/pdf', generarReciboPDF);

module.exports = router;