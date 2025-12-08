import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 1. SETUP: We use the exact key name from your original working code
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY 
});

// 2. LOAD PRODUCTS (THE BRAIN)
// We keep this because without it, she hallucinates prices.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsPath = path.join(__dirname, 'products.json');

let productCatalogString = "Consulte stock manualmente.";
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
            LOGÍSTICA: ${p.politica_envio || ''}
            ---`
        ).join('\n');
    }
} catch (err) {
    console.error("⚠️ Error leyendo products.json:", err.message);
}

// 3. SYSTEM PROMPT (FAVER STYLE + PRODUCTS)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, asesora digital de COPACOL. 
TU META: Asesorar, crear alianzas y cerrar ventas ferreteras.
ESTILO DE VENTA: "Estilo Faver" (Cálido, aliado comercial, transparente).

INVENTARIO REAL (NO inventes productos ni precios distintos a estos):
${productCatalogString}

REGLAS DE COMUNICACIÓN:
- Usa mensajes CORTOS (tipo WhatsApp). No bloques de texto.
- Siempre saluda por el nombre si lo conoces.
- ALIANZA: Usa frases como "Aliados comerciales", "Crecer juntos".
- STOCK: Si el producto está en JSON, véndelo. Si no, di que no lo manejas.
- EMOJIS: Máximo 2 por mensaje (🙏🏽, 👌🏽, 💪🏽, 🙂, 🤝).

CONOCIMIENTO TÉCNICO:
- Presión: Mangueras Calibre 40 (90 PSI) vs Calibre 60 (120 PSI).
- Precios: Si les parece caro, explica durabilidad vs material reciclado.
`;

// 4. TOOLS: RESTORED TO ORIGINAL DEFINITION
// We reverted this to strictly match "ms_..." fields so Kommo/Railway doesn't break.
const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Extrae datos del cliente para preparar despacho cuando el cliente confirme la compra.",
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

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        // SAFETY CHECK 1: Don't send empty messages (Causes 400 Error)
        if (!mensajeUsuario || mensajeUsuario.trim() === "") {
            console.log("⚠️ Mensaje usuario vacío, omitiendo llamada OpenAI.");
            return { content: "¿Hola? Sigo aquí atenta." };
        }

        // SAFETY CHECK 2: Clean History (Contexto)
        // This removes any "null" or broken messages from the past that cause the 2nd message crash.
        const cleanContext = Array.isArray(contexto) 
            ? contexto.filter(msg => msg && msg.role && typeof msg.content === 'string') 
            : [];

        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo", 
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...cleanContext, 
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.5, // 0.5 is better for balancing exact prices with Faver's warmth
        });

        return completion.choices[0].message;

    } catch (error) {
        console.error("❌ OpenAI API Error Details:", error);
        // Fallback para no dejar al cliente en visto
        return { content: "Estoy revisando esa información, dame un segundo... 🧐" };
    }
}