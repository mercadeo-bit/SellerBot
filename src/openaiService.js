import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 1. SETUP: Try both common variable names to be safe
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY
});

// 2. LOAD PRODUCTS
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
} catch (err) {
    console.error("⚠️ Error leyendo products.json:", err.message);
}

// 3. SYSTEM PROMPT (Optimized for Kommo Limits)
// CRITICAL: We explicitly order the AI to keep it short.
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL.
ESTILO: "Estilo Faver" (Amable, concreto, aliado comercial).
INVENTARIO:
${productCatalogString}

⚠️ REGLA DE ORO (TÉCNICA):
Tus respuestas van a un sistema con LÍMITE DE CARACTERES.
**Tu respuesta DEBE tener MENOS DE 250 CARACTERES.**
Si te pasas, el sistema se rompe. Sé ultra-concisa.

REGLAS DE VENTA:
1. Si saludan, saluda corto: "¡Hola {Nombre}! Soy Sofía de Copacol. ¿En qué te apoyo?".
2. Si preguntan precio: Dalo directo. "El soldador vale $319.900. ¿Te interesa?".
3. Si preguntan specs: Resume. "110V, 130A, pesa 3kg. Ideal cerrajería.".
4. Si confirman compra: "Perfecto. Confírmame Dirección y Ciudad para despacho.".

ALERTA DE ERROR:
- Nunca respondas con bloques de texto gigantes.
- Máximo 1 o 2 emojis.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Guardar datos de despacho. ÚSALO SOLO si el cliente ya dio Dirección Y Ciudad.",
            parameters: {
                type: "object",
                properties: {
                    ms_nombre_completo: { type: "string" },
                    ms_telefono: { type: "string" },
                    ms_direccion_exacta: { type: "string" },
                    ms_ciudad: { type: "string" }
                },
                required: ["ms_nombre_completo", "ms_telefono"]
            }
        }
    }
];

// Helper to avoid crashes if history is dirty
function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(msg => ({
        role: msg.role || 'user',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || "")
    }));
}

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        // Validation for empty input
        if (!mensajeUsuario || mensajeUsuario.trim() === "") {
            return { content: "¿Hola? Sigo aquí." };
        }

        const historyClean = sanitizeMessages(contexto);

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...historyClean,
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.4,
            max_tokens: 100 // Force OpenAI to stop generating early to save space
        });

        const msg = response.choices[0].message;

        // FINAL SAFETY CHECK: Content Valid?
        // If content is null (Tool Call), index.js handles it.
        // If content is text, we ensure it exists.
        if (!msg.tool_calls && (!msg.content || msg.content === "null")) {
            return { content: "Estoy revisando el stock, dame un momento." };
        }

        return msg;

    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Dame un segundo, estoy validando información..." };
    }
}