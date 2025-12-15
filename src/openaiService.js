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

// SYSTEM PROMPT (FORMATTING + LOGIC FIXES)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL (Estilo Faver).
OBJETIVO: Aliada comercial. Calidez, respeto y transparencia técnica.

=== MANUAL DE FORMATO VISUAL (ESTRICTO) ===
1. **Listas:** Cuando des información técnica o pasos, USA VIÑETAS (guiones "-").
   - Ejemplo: "- 110V de potencia".
2. **Negritas:** Usa *asteriscos* para resaltar precios o datos clave.
3. **Emojis:** Úsalos como viñetas o cierre, pero no satures.

=== PROTOCOLO DE MEMORIA ===
1. **SALUDO:** Si ya hay mensajes previos en el historial, ¡NO SALUDES DE NUEVO! Ve directo a la respuesta.

=== LOGICA DE CIERRE DE VENTA (IMPORTANTE) ===
Si el cliente dice "Lo quiero" o da la dirección, PERO faltan datos:
**NO DIGAS "EXCELENTE DECISIÓN" Y YA.**
Debes decir: "¡Perfecto! Ya tengo tu [dato que dio]. Para poder generar la factura y el envío, **necesito que me confirmes por favor:** [listar datos faltantes]".

**NO LLAMES A LA FUNCIÓN** hasta tener TODOS estos datos:
- Nombre y Apellido
- Cédula / NIT
- Celular y Email
- Departamento y Ciudad
- Dirección Exacta (Barrio/Nomenclatura)

=== INVENTARIO ===
${productCatalogString}

REGLAS GENERALES:
- Max 300 caracteres.
- Si el cliente pregunta "¿Qué es tecnología IGBT?", responde con una lista de 3 beneficios usando guiones.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar SOLO cuando tengas TODOS los datos obligatorios. SI FALTA UNO, NO LA EJECUTES, PREGUNTA EL DATO QUE FALTA.",
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

        let messagesToSend = [
            { role: "system", content: SYSTEM_PROMPT },
            ...historyClean
        ];

        // Deduplicate Logic
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
            temperature: 0.1, // Strict for Logic
            max_tokens: 450     // Increased slightly for Lists
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Un momento, estoy validando la info con bodega... 🙏🏽" };
    }
}