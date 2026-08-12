-- Migración: Tipo de item PORCENTAJE con base_token
-- El resultado de un item PORCENTAJE = valor(base_token) * porcentaje / 100
-- Ej: "Jubilación" con porcentaje 11 y base_token 'BR' -> BR * 11 / 100

-- Columna en la tabla de items globales
ALTER TABLE item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);

-- Columna en el snapshot congelado de la liquidación
ALTER TABLE liquidacion_item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);

-- Migración: Sueldo Básico del empleado
-- El item con token 'SB' (Sueldo Básico) toma por defecto este valor en cada liquidación.
-- Al editarse dentro de una liquidación, el valor se guarda también acá.
-- Es un item DISTINTO de "Sueldo Bruto" (SBRU), que se carga manualmente.
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS sueldo_basico NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Item global "Sueldo Básico" (token SB), el núcleo del recibo de sueldo.
-- No puede eliminarse ni desactivarse dentro de una liquidación.
INSERT INTO item (nombre, token, tipo, naturaleza, formula, porcentaje, base_token)
SELECT 'Sueldo Básico', 'SB', 'MANUAL', 'SUMA', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM item WHERE token = 'SB');

-- Migración: índice de nombre de categoría que respeta el soft delete.
-- Con esto una categoría dada de baja puede volver a crearse con el mismo nombre
-- sin violar la unicidad (los snapshots históricos conservan su nombre propio).
ALTER TABLE categoria DROP CONSTRAINT IF EXISTS categoria_nombre_key;
CREATE UNIQUE INDEX IF NOT EXISTS categoria_nombre_key ON categoria (nombre) WHERE eliminado = FALSE;
