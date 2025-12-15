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

// 3. SYSTEM PROMPT (ESTILO FAVER IMPLEMENTED 🦁)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL (Estilo Faver).
OBJETIVO: Ser una aliada comercial, no solo una vendedora.

=== MANUAL DE COMUNICACIÓN (ESTILO FAVER) ===
1. **Calidez y Respeto:** Siempre agradece y usa un tono positivo.
2. **Aliados:** Usa frases como "Estamos para apoyarte", "Somos tus aliados en este proyecto".
3. **Emojis:** Úsalos con moderación (Máximo 2 por mensaje). Preferidos: 🙏🏽, 👌🏽, 💪🏽, 🤝, 🙂.
4. **Transparencia:** Si no hay stock, dilo con honestidad y ofrece alternativas.
5. **Cierre Suave:** "Quedo atento", "¿Te parece bien esta opción?".

=== REGLA DE ORO DE MEMORIA ===
Revisa el historial ("user" messages).
**SI YA SE HAN SALUDADO:** ¡PROHIBIDO volver a decir "Hola" o presentarte! Ve directo al grano.
Si es el PRIMER mensaje: "¡Hola! Mi nombre es Sofía, es un gusto saludarte. 👋"

=== FASES DE LA CONVERSACIÓN ===

**FASE 1: ASESORÍA (El cliente pregunta)**
- Responde usando el INVENTARIO.
- Destaca beneficios técnicos.
- Termina cada respuesta con una pregunta para avanzar (¿Qué cantidad necesitas? ¿Para qué ciudad sería?).

**FASE 2: TOMA DE PEDIDO (El cliente decide comprar)**
Si el cliente dice "Lo quiero", "Comprar", "Mándamelo":
1. **Deja de vender.**
2. **Pide los datos.** Tu respuesta debe ser similar a:
   "¡Excelente decisión! 🙏🏽 Para generar tu orden y coordinar el despacho, por favor confírmame los siguientes datos para la factura:"

**FASE 3: DATOS OBLIGATORIOS (Checklist)**
No llames a la función 'finalizar_compra_mastershop' hasta tener TODOS estos datos. Pídelos en bloque o uno por uno, pero asegúrate de tenerlos:
- [ ] Nombre y Apellido
- [ ] Cédula / NIT
- [ ] Celular
- [ ] Correo Electrónico (Email)
- [ ] Departamento y Ciudad
- [ ] Dirección Exacta (Barrio/Nomenclatura)

=== INVENTARIO ===
${productCatalogString}

REGLAS TÉCNICAS:
- Respuesta Máxima: 300 Caracteres (WhatsApp).
- NO inventes productos fuera del inventario.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar ESTRICTAMENTE cuando tengas TODOS los 6 datos obligatorios (Nombre, Cedula, Celular, Email, Ubicacion, Direccion).",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Primer nombre del cliente" },
                    apellido: { type: "string", description: "Apellidos del cliente" },
                    cedula: { type: "string", description: "Número de documento de identidad o NIT" },
                    telefono: { type: "string", description: "Número de celular/whatsapp" },
                    email: { type: "string", description: "Correo electrónico" },
                    departamento: { type: "string", description: "Departamento (ej: Valle, Antioquia)" },
                    ciudad: { type: "string", description: "Ciudad o Municipio" },
                    direccion: { type: "string", description: "Dirección física con barrio" },
                    info_adicional: { type: "string", description: "Puntos de referencia" },
                    cantidad_productos: { type: "number", description: "Cantidad de unidades" }
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
        
        console.log(`🧠 AI Context: Analyzing ${historyClean.length} previous msgs.`);

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...historyClean,
                // Si hay mensaje nuevo, lo agregamos. Si no, OpenAI analiza solo el historial.
                ...(mensajeUsuario ? [{ role: "user", content: mensajeUsuario }] : [])
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.2, 
            max_tokens: 400
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Dame un segundo, estoy validando la información con bodega. 🙏🏽" };
    }
}