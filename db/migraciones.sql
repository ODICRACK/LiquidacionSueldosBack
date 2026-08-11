-- Migración: Tipo de item PORCENTAJE con base_token
-- El resultado de un item PORCENTAJE = valor(base_token) * porcentaje / 100
-- Ej: "Jubilación" con porcentaje 11 y base_token 'BR' -> BR * 11 / 100

-- Columna en la tabla de items globales
ALTER TABLE item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);

-- Columna en el snapshot congelado de la liquidación
ALTER TABLE liquidacion_item ADD COLUMN IF NOT EXISTS base_token VARCHAR(20);
