// Extrae los tokens de una fórmula (ej: "BR * 0.11" -> ["BR"])
const extraerTokens = (formula) => {
    if (!formula) return [];
    // Busca palabras compuestas por letras mayúsculas (los tokens)
    const matches = formula.match(/[A-Z]+/g);
    return matches ? [...new Set(matches)] : [];
};

// Verifica si al agregar la 'nuevaFormula' al 'tokenDestino' se genera un ciclo
const detectarCiclo = (tokenDestino, nuevaFormula, itemsExistentes) => {
    const tokensNuevaFormula = extraerTokens(nuevaFormula);
    
    // Mapa de dependencias actual
    const dependencias = {};
    itemsExistentes.forEach(item => {
        if (item.tipo === 'FORMULA' && item.formula) {
            dependencias[item.token] = extraerTokens(item.formula);
        } else {
            dependencias[item.token] = [];
        }
    });

    // Actualizamos el mapa con el intento de nueva configuración
    dependencias[tokenDestino] = tokensNuevaFormula;

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

    const visitados = new Set();
    const caminoActual = new Set();

    return visitar(tokenDestino, visitados, caminoActual);
};

module.exports = { extraerTokens, detectarCiclo };