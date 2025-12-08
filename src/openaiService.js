import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 1. SETUP
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

// 3. SYSTEM PROMPT
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL.
ESTILO: "Estilo Faver" (Amable, concreto, aliado comercial).
INVENTARIO:
${productCatalogString}

=== OBJETIVO PRINCIPAL: CERRAR LA VENTA ===
Cuando el cliente diga "SÍ", "Lo quiero" o confirme interés de compra:
1. Deja de vender y entra en **MODO RECOLECCIÓN DE DATOS**.
2. Tu meta es llenar la herramienta 'finalizar_compra_mastershop'.
3. NO inventes datos. Pídeselos al cliente uno por uno o en grupo.

=== DATOS OBLIGATORIOS PARA LA ORDEN ===
Necesitas obtener (y separar) estos datos:
- Nombre y Apellido (Sepáralos mentalmente).
- Cédula / NIT (Dato numérico).
- Teléfono.
- Correo Electrónico.
- Departamento (Ej: Valle del Cauca, Antioquia, Cundinamarca).
- Ciudad (Ej: Cali, Medellín, Buga).
- Dirección exacta (Barrio, nomenclatura).

⚠️ REGLA DE ORO:
- Tu respuesta final DEBE ser MENOS DE 250 CARACTERES para WhatsApp.
- Si faltan datos, pídelos amablemente: "¡Genial! Para generar la orden, confírmame por favor: Nombre completo, Cédula y Departamento."
- Solo cuando tengas TODO, llama a la función.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar ESTRICTAMENTE cuando tengas TODOS los datos para crear la orden.",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Primer nombre del cliente" },
                    apellido: { type: "string", description: "Apellidos del cliente" },
                    cedula: { type: "string", description: "Número de documento de identidad" },
                    telefono: { type: "string", description: "Número de celular/whatsapp" },
                    email: { type: "string", description: "Correo electrónico (si no tiene, pon: noaplica@copacol.com)" },
                    departamento: { type: "string", description: "Nombre completo del departamento (ej: Valle del Cauca)" },
                    ciudad: { type: "string", description: "Nombre de la ciudad o municipio" },
                    direccion: { type: "string", description: "Dirección física con barrio" },
                    info_adicional: { type: "string", description: "Notas adicionales o puntos de referencia" },
                    cantidad_productos: { type: "number", description: "Cantidad de unidades que desea llevar" }
                },
                required: ["nombre", "apellido", "cedula", "telefono", "departamento", "ciudad", "direccion"]
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
        if (!mensajeUsuario || mensajeUsuario.trim() === "") return { content: "Sigo aquí." };
        
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
            temperature: 0.2, // Baja temperatura para que sea estricto con los datos
            max_tokens: 150
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Estamos validando disponibilidad, un segundo." };
    }
}