// Redondeo según Regla 11: Cualquier fracción de centavo eleva al centavo superior.
const redondear = (valor) => {
    return Math.ceil(valor * 100) / 100;
};

const precedencia = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };

// Convierte una expresión infija (A + B) a postfija (A B +)
const shuntingYard = (tokens) => {
    const salida = [];
    const operadores = [];

    for (const token of tokens) {
        if (!isNaN(parseFloat(token))) {
            salida.push(parseFloat(token));
        } else if (token === '(') {
            operadores.push(token);
        } else if (token === ')') {
            while (operadores.length > 0 && operadores[operadores.length - 1] !== '(') {
                salida.push(operadores.pop());
            }
            operadores.pop(); // Eliminar '('
        } else {
            while (
                operadores.length > 0 &&
                precedencia[operadores[operadores.length - 1]] >= precedencia[token]
            ) {
                salida.push(operadores.pop());
            }
            operadores.push(token);
        }
    }
    while (operadores.length > 0) salida.push(operadores.pop());
    return salida;
};

const evaluarPostfija = (tokens) => {
    const pila = [];
    for (const token of tokens) {
        if (typeof token === 'number') {
            pila.push(token);
        } else {
            const b = pila.pop();
            const a = pila.pop();
            switch (token) {
                case '+': pila.push(a + b); break;
                case '-': pila.push(a - b); break;
                case '*': pila.push(a * b); break;
                case '/': pila.push(a / b); break;
                case '%': pila.push(a * (b / 100)); break; // A % B -> A * (B/100)
            }
        }
    }
    return pila[0];
};

const calcularFormula = (formula, contextoValores) => {
    if (!formula) return 0;
    
    // Reemplazar los tokens por sus valores en el contexto
    let formulaConValores = formula;
    const tokensUtilizados = formula.match(/[A-Z]+/g) || [];
    
    for (const token of tokensUtilizados) {
        const valor = contextoValores[token] || 0;
        // Evitar reemplazar sub-strings (ej: si existe "B" y "BR")
        const regex = new RegExp(`\\b${token}\\b`, 'g');
        formulaConValores = formulaConValores.replace(regex, valor);
    }

    // Extraer números y operadores permitidos
    const tokens = formulaConValores.match(/\d+(?:\.\d+)?|[\+\-\*\/\%\(\)]/g);
    if (!tokens) return 0;

    const tokensPostfijos = shuntingYard(tokens);
    const resultadoBruto = evaluarPostfija(tokensPostfijos);
    
    return isNaN(resultadoBruto) ? 0 : redondear(resultadoBruto);
};
module.exports = { redondear, calcularFormula }