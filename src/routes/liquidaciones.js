const express = require('express');
const router = express.Router();
const { crearLiquidacion, getLiquidacion, actualizarBorrador, finalizarLiquidacion, copiarConfiguracion, reabrirLiquidacion, sincronizarItems } = require('../controllers/liquidacionesController');
const { getDatosRecibo } = require('../controllers/reciboController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', crearLiquidacion);
router.get('/:id', getLiquidacion);
router.put('/:id/borrador', actualizarBorrador);
router.put('/:id/finalizar', finalizarLiquidacion);
router.post('/:id/copiar', copiarConfiguracion);
router.get('/:id/recibo', getDatosRecibo);
router.put('/:id/reabrir', reabrirLiquidacion);
router.put('/:id/sincronizar', sincronizarItems);
module.exports = router;