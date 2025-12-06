import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 1. SETUP & CONFIGURATION
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Helper to load products dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsPath = path.join(__dirname, 'products.json');

// Safely load product data (Prevent crash if file is missing/empty during dev)
let productCatalogString = "No hay productos disponibles por el momento.";
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
            ESPECIFICACIONES: ${(p.especificaciones_tecnicas ? JSON.stringify(p.especificaciones_tecnicas) : '')}
            ENVÍO/LOGÍSTICA: ${p.politica_envio || ''}
            ---`
        ).join('\n');
    } else {
        console.warn("⚠️ ALERTA: No se encontró products.json en " + productsPath);
    }
} catch (err) {
    console.error("⚠️ Error leyendo products.json:", err.message);
}

// 2. THE BRAIN: SYSTEM PROMPT
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL.
ESTILO DE VENTA: Sigues el "Estilo Faver".
OBJETIVO: Calificar leads, responder dudas técnicas con precisión y cerrar ventas.
INVENTARIO: Solo puedes vender lo siguiente. No inventes precios ni productos:
${productCatalogString}

=== PRINCIPIOS DE COMUNICACIÓN (ESTILO FAVER) ===
1. TONO: Cálido, aliado comercial (partners), servicial.
2. ALIANZA: Frases clave: "Crecer juntos", "Construir relación", "Hacer parte de su equipo".
3. FORMATO: Mensajes cortos (WhatsApp style). Máximo 1 o 2 emojis (🙏🏽, 👌🏽, 💪🏽, 🙂).
4. CIERRE: No presiones. "¿Quedamos con este pedido?", "¿Cómo te gustaría proceder?".

=== CONOCIMIENTO TÉCNICO ===
- Mangueras: Calibre 40 (90 PSI), Calibre 60 (120 PSI). Si buscan barato, menciona material reciclado pero explica durabilidad.
- Stock: Si algo no está (según json), sé honesta: "Hoy no llegó, ¿te envío lo demás?".

=== REGLAS ===
- Respuesta CORTA (ideal para móvil).
- SI CONFIRMAN COMPRA: Pide Dirección y Ciudad. Llama a 'update_delivery_info'.
- Si preguntan precio: Dalo exacto del catálogo + info de envío (ej: Gratis en Cali).
`;

const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Guardar datos de despacho cuando el cliente confirma compra.",
            parameters: {
                type: "object",
                properties: {
                    cedula: { type: "string" },
                    direccion: { type: "string" },
                    ciudad: { type: "string" }
                },
                required: ["direccion", "ciudad"]
            }
        }
    }
];

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        // Validation: Prevent 400 errors if message is empty
        if (!mensajeUsuario || mensajeUsuario.trim() === "") {
            return { content: "¿Hola? ¿Sigues ahí? Estoy atenta." };
        }

        const hoy = new Date();
        const opciones = { weekday: 'long', hour: 'numeric', minute: 'numeric' };
        const fechaActual = hoy.toLocaleDateString('es-CO', opciones);

        // Clean Context: Filter out any invalid messages from history that might crash OpenAI
        const cleanContext = Array.isArray(contexto) ? contexto.filter(msg => msg && msg.role && msg.content !== null) : [];

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: SYSTEM_PROMPT + `\n(Fecha: ${fechaActual})` },
                ...cleanContext, 
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.3,
        });
        
        return response.choices[0].message;
    } catch (error) {
        // Detailed error logging for debugging 400s
        if (error.response) {
            console.error("❌ OpenAI API 400+ Error Data:", JSON.stringify(error.response.data));
        } else {
            console.error("❌ OpenAI API Error:", error.message);
        }
        return { content: "Estoy validando esa información, dame un momento por favor." };
    }
}