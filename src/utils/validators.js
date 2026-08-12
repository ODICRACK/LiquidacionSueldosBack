// Validaciones de entrada compartidas entre los controladores.
// Se usa validación manual (sin dependencias) por simplicidad y mantenibilidad.

const validarRequerido = (valor, campo) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
        throw new Error(`El campo ${campo} es obligatorio.`);
    }
    return String(valor).trim();
};

const validarToken = (token) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(token)) {
        throw new Error('El token debe iniciar con una letra mayúscula y contener solo mayúsculas, números y guión bajo.');
    }
    return token;
};

const validarMes = (mes) => {
    const m = Number(mes);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
        throw new Error('El mes debe ser un número entre 1 y 12.');
    }
    return m;
};

const validarAnio = (anio) => {
    const a = Number(anio);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
        throw new Error('El año no es válido.');
    }
    return a;
};

const validarNumeroPositivo = (valor, campo) => {
    if (valor === undefined || valor === null || valor === '') return undefined;
    const n = Number(valor);
    if (!isFinite(n) || n < 0) {
        throw new Error(`El campo ${campo} debe ser un número positivo.`);
    }
    return n;
};

const validarOpcion = (valor, opciones, campo) => {
    if (!opciones.includes(valor)) {
        throw new Error(`El campo ${campo} tiene un valor no válido.`);
    }
    return valor;
};

module.exports = { validarRequerido, validarToken, validarMes, validarAnio, validarNumeroPositivo, validarOpcion };
