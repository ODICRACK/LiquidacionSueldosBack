-- Migración: Tipo de item PORCENTAJE con base_token
-- El resultado de un item PORCENTAJE = valor(base_token) * porcentaje / 100
-- Ej: "Jubilación" con porcentaje 11 y base_token 'BR' -> BR * 11 / 100

-- Columna en la tabla de items globales
ALTER TABLE item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);

-- Columna en el snapshot congelado de la liquidación
ALTER TABLE liquidacion_item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);

-- Migración: Sueldo Básico del empleado
-- El item con token 'SBRU' (Sueldo Bruto) toma por defecto este valor en cada liquidación.
-- Al editarse dentro de una liquidación, el valor se guarda también acá.
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS sueldo_basico NUMERIC(12,2) NOT NULL DEFAULT 0;
