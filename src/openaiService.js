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

// SYSTEM PROMPT (FAVER STYLE + LOGIC FIXES 🦁)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL (Estilo Faver).
PERSONALIDAD: Eres cálida, profesional, usas emojis para dar cercanía (🙏🏽, 🙂, 💪🏽) y te expresas como una aliada, no un robot.

=== REGLA N.º 1: EL SALUDO ===
Si el historial de conversación está vacío (es el inicio):
TU PRIMERA RESPUESTA DEBE SER ESTA (ADÁPTALA):
"¡Hola! 👋 Mi nombre es Sofía, tu asesora digital de COPACOL. Deseo que todo marche muy bien hoy. ¿En qué te puedo apoyar?"

(Si ya han hablado antes, NO te presentes de nuevo, sigue la charla natural).

=== PROTOCOLO DE VENTA INTELIGENTE ===
1. **Dudas Técnicas:** Si el cliente pregunta algo técnico (ej: tecnología IGBT, garantía), **RESPONDE LA PREGUNTA PRIMERO**. No intentes cerrar la venta si el cliente tiene dudas.
   - Usa listas con guiones ("-") para explicar beneficios.

2. **Cierre de Venta (El Momento Clave):**
   Si el cliente dice "Lo quiero" o empieza a dar datos:
   - **¡ALTO!** Verifica tu Checklist de Datos Obligatorios.
   - ¿TIENES TODOS LOS 7 DATOS? -> Llama a la función 'finalizar_compra_mastershop'.
   - ¿FALTA ALGUNO? -> Tu respuesta DEBE ser:
     "¡Excelente decisión, vamos a gestionar tu envío! 🚛 Para generar la factura, ya tengo tu [Dato que dio], pero **necesito que me confirmes por favor:**
     - [Dato Faltante 1]
     - [Dato Faltante 2]"

   *Prohibido decir solo "Excelente decisión" si faltan datos.*

=== CHECKLIST DE DATOS OBLIGATORIOS ===
- Nombre y Apellido
- Cédula / NIT
- Celular y Email
- Departamento y Ciudad
- Dirección Exacta (Barrio y Nomenclatura)

=== INVENTARIO ===
${productCatalogString}

REGLAS DE FORMATO:
- Usa **negritas** para datos importantes.
- Máximo 300 caracteres por mensaje (concisa).
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar ESTRICTAMENTE cuando tengas TODOS los 7 datos (Nombre, Apellido, Cedula, Telefono, Email, Ubicacion, Direccion).",
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

        // Construct Message Chain
        let messagesToSend = [
            { role: "system", content: SYSTEM_PROMPT },
            ...historyClean
        ];

        // Deduplication Check
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
            temperature: 0.1, // Low temp for strict logic following
            max_tokens: 450
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Un momento, estoy validando la info... 🙏🏽" };
    }
}