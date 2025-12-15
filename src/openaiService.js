import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY
});

// LOAD PRODUCTS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsPath = path.join(__dirname, 'products.json');

let productCatalogString = "Consultar inventario manual.";
try {
    if (fs.existsSync(productsPath)) {
        const productsData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
        productCatalogString = productsData.map(p => 
            `---
            ID: ${p.id} | PRODUCTO: ${p.nombre}
            PRECIO: $${(p.precio || 0).toLocaleString('es-CO')}
            RESUMEN: ${p.descripcion_corta || ''}
            BENEFICIO: ${(p.beneficios || []).slice(0, 2).join(', ')} 
            ENVÍO: ${p.politica_envio || ''}
            ---`
        ).join('\n');
    }
} catch (err) {}

// SYSTEM PROMPT (FAVER STYLE 🦁)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL (Estilo Faver).
OBJETIVO: Aliada comercial. Calidez, respeto y transparencia técnica.

=== MANUAL DE COMUNICACIÓN (ESTILO FAVER) ===
1. **Calidez:** Inicia siempre deseando bienestar si saludas ("Deseo que todo marche bien").
2. **Rol:** Si es el primer mensaje: "Soy Sofía, tu asesora digital COPACOL".
3. **Emojis:** Máximo 2 (🙏🏽, 👌🏽, 💪🏽, 🤝, 🙂).
4. **Aliados:** "Estamos para apoyarte", "Nos alegra acompañarte en tu crecimiento".

=== PROTOCOLO DE MEMORIA (CRÍTICO) ===
Analiza el historial.
1. **¿ESTAMOS EMPEZANDO?** (Historial vacío o solo 1 mensaje): 
   - SIEMPRE saluda y preséntate: "¡Hola! Mi nombre es Sofía de COPACOL..."
   - LUEGO responde la pregunta del cliente.
2. **¿YA ESTAMOS HABLANDO?** (Historial > 1 mensaje):
   - **PROHIBIDO** volver a presentarse. NO digas "Mi nombre es Sofía" otra vez.
   - Ve directo a la respuesta o seguimiento.

=== FASES DEL CHAT ===
**FASE 1: CONSULTA**
- Responde usando el INVENTARIO.
- Pregunta para avanzar: "¿Para qué ciudad lo necesitas?", "¿Qué cantidad tienes en mente?".

**FASE 2: CIERRE (EL CLIENTE DICE "LO QUIERO")**
- **¡DETÉN LA VENTA!** No des más specs.
- Tu respuesta DEBE ser: "¡Excelente decisión! 🙏🏽 Para generar tu orden y coordinar el despacho, confírmame por favor estos datos:"

**FASE 3: DATOS REQUERIDOS**
Solicita TODO esto antes de llamar a la función. Puedes pedirlos en bloque.
- Nombre y Apellido
- Cédula / NIT
- Celular y Email
- Departamento y Ciudad
- Dirección Exacta (Barrio)

=== INVENTARIO ===
${productCatalogString}

REGLAS:
- Max 300 caracteres.
- Sé servicial y técnicamente honesto.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar SOLO cuando tengas TODOS los datos obligatorios del cliente.",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Primer nombre" },
                    apellido: { type: "string", description: "Apellidos" },
                    cedula: { type: "string", description: "DNI o NIT" },
                    telefono: { type: "string", description: "Celular" },
                    email: { type: "string", description: "Email" },
                    departamento: { type: "string", description: "Departamento" },
                    ciudad: { type: "string", description: "Ciudad" },
                    direccion: { type: "string", description: "Dirección física" },
                    info_adicional: { type: "string", description: "Referencias" },
                    cantidad_productos: { type: "number", description: "Cantidad" }
                },
                required: ["nombre", "apellido", "cedula", "telefono", "email", "departamento", "ciudad", "direccion"]
            }
        }
    }
];

function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(msg => ({
        role: msg.role || 'user',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || "")
    }));
}

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        const historyClean = sanitizeMessages(contexto);
        console.log(`🧠 AI Processing... Context size: ${historyClean.length}`);

        // OPTIMIZATION: Check if the user message is ALREADY at the end of the history
        // to avoid duplicating it (since index.js adds it locally first).
        let messagesToSend = [
            { role: "system", content: SYSTEM_PROMPT },
            ...historyClean
        ];

        // Only add 'mensajeUsuario' if it's NOT the last message in history
        if (mensajeUsuario) {
            const lastMsg = historyClean[historyClean.length - 1];
            if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== mensajeUsuario) {
                messagesToSend.push({ role: "user", content: mensajeUsuario });
            }
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: messagesToSend,
            tools: tools,
            tool_choice: "auto",
            temperature: 0.1,
            max_tokens: 350
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Un momento, estoy validando la info... 🙏🏽" };
    }
}