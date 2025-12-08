import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 1. SETUP: Use exact key from your env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY 
});

// 2. LOAD PRODUCTS SAFELY
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsPath = path.join(__dirname, 'products.json');

let productCatalogString = "Consultar stock manualmente.";
try {
    if (fs.existsSync(productsPath)) {
        const productsData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
        productCatalogString = productsData.map(p => 
            `---
            ID: ${p.id}
            PRODUCTO: ${p.nombre} (Ref: ${p.referencia || 'N/A'})
            PRECIO: $${(p.precio || 0).toLocaleString('es-CO')} COP
            DESCRIPCIÓN: ${p.descripcion_corta || ''}
            BENEFICIOS: ${(p.beneficios || []).join(', ')}
            LOGÍSTICA: ${p.politica_envio || ''}
            ---`
        ).join('\n');
    }
} catch (err) {
    console.error("⚠️ Error reading products.json:", err.message);
}

// 3. SYSTEM PROMPT
const SYSTEM_PROMPT = `
Eres Sofía, asesora digital de COPACOL. 
TU META: Asesorar, crear alianzas y cerrar ventas ferreteras.
ESTILO: "Estilo Faver" (Cálido, corto, profesional).

INVENTARIO REAL (Usa estos datos, no inventes):
${productCatalogString}

REGLAS:
1. Siempre saluda por el nombre si lo conoces.
2. MENSAJES CORTOS: Máximo 3 oraciones.
3. STOCK: Si está en la lista, véndelo. Si no, di "no lo manejo por ahora".
4. PRECIO: Si piden descuento, explica calidad (Original vs Reciclado).

DATOS TÉCNICOS:
- Mangueras: Calibre 40 (90 PSI), Calibre 60 (120 PSI).
`;

// 4. TOOLS (Using original ms_ prefixes to prevent pipeline errors)
const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Extrae datos del cliente para preparar despacho.",
            parameters: {
                type: "object",
                properties: {
                    ms_nombre_completo: { type: "string" },
                    ms_documento_numero: { type: "string" },
                    ms_direccion_exacta: { type: "string" },
                    ms_ciudad: { type: "string" },
                    ms_telefono: { type: "string" }
                },
                required: ["ms_nombre_completo", "ms_telefono"]
            }
        }
    }
];

// 5. HELPER: Sanitize Context
// This function fixes the 400 Error by repairing broken history objects
function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return [];

    return messages.map(msg => {
        // Safe copy of the message
        const safeMsg = { 
            role: msg.role || 'user', // Default to user if role missing
            content: msg.content 
        };

        // Rule 1: Content must be a string, or null (only if tools exist)
        if (safeMsg.content === undefined || safeMsg.content === null) {
            safeMsg.content = ""; // Force empty string instead of null to be safe
        }
        
        // Rule 2: Ensure content is strictly string
        if (typeof safeMsg.content !== 'string') {
            safeMsg.content = JSON.stringify(safeMsg.content);
        }

        return safeMsg;
    });
}

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        // Prevent empty user message crash
        if (!mensajeUsuario || mensajeUsuario.trim() === "") {
            return { content: "Estoy atenta, ¿me decías?" };
        }

        // --- THE FIX IS HERE ---
        // We clean the history before sending it to OpenAI
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
            temperature: 0.5,
        });

        return response.choices[0].message;

    } catch (error) {
        // Log the exact reason for the crash
        if (error.response) {
            console.error("❌ OpenAI API REFUSED (400) - DATA:", JSON.stringify(error.response.data));
        } else {
            console.error("❌ OpenAI API ERROR:", error.message);
        }
        return { content: "Dame un momento, estoy verificando esa información..." };
    }
}