// Extrae los tokens de una fórmula (ej: "BR * 0.11" -> ["BR"])
const extraerTokens = (formula) => {
    if (!formula) return [];
    // Busca palabras compuestas por letras mayúsculas (los tokens)
    const matches = formula.match(/[A-Z]+/g);
    return matches ? [...new Set(matches)] : [];
};

// Valida que la fórmula solo contenga caracteres permitidos (sin eval ni código)
const validarFormulaChars = (formula) => {
    if (!formula || !formula.trim()) throw new Error('La fórmula no puede estar vacía.');
    const permitido = /^[A-Z0-9+\-*/%(). ]+$/;
    if (!permitido.test(formula)) {
        throw new Error('La fórmula contiene caracteres no permitidos. Use solo letras A-Z, números, espacios y + - * / % ( ).');
    }
};

// Verifica si al configurar el 'tokenDestino' con las nuevas dependencias
// (datos = { formula } o { base_token }) se genera un ciclo.
// itemsExistentes: los items activos de la base (excluyen al tokenDestino con los datos viejos).
const detectarCiclo = (tokenDestino, datos, itemsExistentes) => {
    const dependencias = {};

    // Dependencias actuales de los items existentes
    itemsExistentes.forEach(item => {
        if (item.tipo === 'FORMULA' && item.formula) {
            dependencias[item.token] = extraerTokens(item.formula);
        } else if (item.tipo === 'PORCENTAJE' && item.base_token) {
            dependencias[item.token] = [item.base_token];
        } else {
            dependencias[item.token] = [];
        }
    });

    // Dependencias nuevas del item que se está guardando
    if (datos && datos.formula) {
        dependencias[tokenDestino] = extraerTokens(datos.formula);
    } else if (datos && datos.base_token) {
        dependencias[tokenDestino] = [datos.base_token];
    } else {
        dependencias[tokenDestino] = [];
    }

    // Función recursiva DFS para detectar ciclos
    const visitar = (tokenActual, visitados, caminoActual) => {
        if (caminoActual.has(tokenActual)) return true; // Ciclo detectado!
        if (visitados.has(tokenActual)) return false;   // Ya evaluado, sin ciclos

        visitados.add(tokenActual);
        caminoActual.add(tokenActual);

        const dependenciasDelToken = dependencias[tokenActual] || [];
        for (const dep of dependenciasDelToken) {
            if (visitar(dep, visitados, caminoActual)) {
                return true;
            }
        }

        caminoActual.delete(tokenActual);
        return false;
    };

    return visitar(tokenDestino, new Set(), new Set());
};

module.exports = { extraerTokens, detectarCiclo, validarFormulaChars };
