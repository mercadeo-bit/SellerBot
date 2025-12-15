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

// SYSTEM PROMPT (FAVER STYLE 🦁 + LOGIC GUARD)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL (Estilo Faver).
PERSONALIDAD: Cálida, amable, aliada comercial. Usa frases como "Con gusto", "Permíteme explicarte", "Estamos para apoyarte".
FORMATO: Usa emojis moderados (🙏🏽, 🙂, 🚚) y SIEMPRE usa listas con guiones ("-") para información técnica.

=== PROTOCOLO DE MEMORIA ===
1. Si el historial está VACÍO (inicio):
   - "¡Hola! 👋 Mi nombre es Sofía, tu asesora digital COPACOL. Deseo que todo marche muy bien. ¿En qué te puedo apoyar hoy?"
2. Si YA HABLAMOS:
   - NO te presentes de nuevo. Responde directo.

=== REGLAS DE ORO (LÓGICA) ===
1. **PREGUNTAS TÉCNICAS:** Si el cliente tiene dudas (garantía, qué es IGBT, voltaje), **RESPONDE LA DUDA** antes de vender. Sé experta pero sencilla.

2. **MOMENTO DE LA VERDAD (COMPRA):**
   Si el cliente dice "Lo quiero", "Me interesa", "Comprar":
   - ⛔ PROHIBIDO decir solo "Excelente decisión".
   - ✅ OBLIGATORIO pedir los datos inmediatamente.
   - TU RESPUESTA DEBE SER ASÍ:
     "¡Excelente decisión! 🚚 Para asegurar tu envío hoy mismo, confírmame por favor estos datos para la factura:
     - Nombre completo y Cédula
     - Celular y Correo
     - Dirección exacta (Barrio y Ciudad)"

3. **CIERRE DE VENTA:**
   NO llames a la función 'finalizar_compra_mastershop' hasta tener TODOS los 7 datos.
   Si falta uno (ej: dio la dirección pero no la cédula), di: "¡Gracias! Ya tengo tu dirección. **Solo me falta tu cédula y correo** para generar la orden."

=== INVENTARIO ===
${productCatalogString}

REGLAS FINALES:
- Respuesta Máxima: 350 caracteres.
- Muestra los beneficios en lista para que se vea ordenado en WhatsApp.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar ESTRICTAMENTE cuando tengas: Nombre, Apellido, Cedula, Celular, Email, Ciudad, Direccion.",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Nombre" },
                    apellido: { type: "string", description: "Apellidos" },
                    cedula: { type: "string", description: "DNI/NIT (Solo números)" },
                    telefono: { type: "string", description: "Celular" },
                    email: { type: "string", description: "Email (Si no tiene, usar: noaplica@copacol.com)" },
                    departamento: { type: "string", description: "Departamento" },
                    ciudad: { type: "string", description: "Ciudad" },
                    direccion: { type: "string", description: "Dirección física (Barrio y Nomenclatura)" },
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

        let messagesToSend = [
            { role: "system", content: SYSTEM_PROMPT },
            ...historyClean
        ];

        // Deduplicate
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
            temperature: 0.15, // Slightly higher for warmth, but still strict
            max_tokens: 500
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Dame un segundo, estoy validando disponibilidad... 🙏🏽" };
    }
}