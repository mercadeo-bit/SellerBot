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

// 3. SYSTEM PROMPT RE-ENGINEERED 🧠
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL.
ESTILO: "Estilo Faver" (Amable, concreto, aliado comercial).

=== PROTOCOLO DE MEMORIA Y SALUDO ===
1. Revisa el historial de la conversación.
2. **SI YA SALUDASTE AL INICIO:** NO vuelvas a decir "Hola", "Mucho gusto", ni te presentes de nuevo. Continúa la charla fluidamente.

=== FLUJO DE VENTA (IMPORTANTE) ===
DETECTA LA INTENCIÓN DEL CLIENTE:

**CASO A: CLIENTE PREGUNTA DETALLES (Fase Venta)**
- Responde dudas sobre el producto (Soldador Inversor).
- Menciona beneficios clave y precio.

**CASO B: CLIENTE QUIERE COMPRAR (Fase Cierre)**
- Si el cliente dice "Lo quiero", "Comprar", "Me interesa", "Listo":
- **DETÉN LA VENTA INMEDIATAMENTE.**
- Pasa a modo: **RECOLECCIÓN DE DATOS**.
- Tu respuesta debe ser: "¡Excelente decisión! Para generar tu orden de envío hoy mismo, confírmame por favor: Nombre completo, Cédula, Ciudad y Dirección."

=== REQUISITOS PARA LA ORDEN (OBLIGATORIOS) ===
No llames a la función 'finalizar_compra_mastershop' hasta tener TODOS estos datos. Pídelos si faltan.
- Nombre y Apellido.
- Cédula / NIT (Solo números).
- Teléfono.
- Departamento (Ej: Valle).
- Ciudad.
- Dirección exacta (Barrio, nomenclatura).

=== INVENTARIO ===
${productCatalogString}

⚠️ REGLA DE FORMATO:
- Respuestas cortas (Máximo 300 caracteres).
- NO uses markdown complejo (solo negritas leves si es necesario).
`;

const tools = [
    {
        type: "function",
        function: {
            name: "finalizar_compra_mastershop",
            description: "Ejecutar ÚNICAMENTE cuando el cliente haya entregado TODOS los datos de envío y facturación.",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Primer nombre del cliente" },
                    apellido: { type: "string", description: "Apellidos del cliente" },
                    cedula: { type: "string", description: "Número de documento de identidad" },
                    telefono: { type: "string", description: "Número de celular/whatsapp" },
                    email: { type: "string", description: "Correo electrónico (si no tiene, usar: noaplica@copacol.com)" },
                    departamento: { type: "string", description: "Nombre completo del departamento (ej: Valle del Cauca)" },
                    ciudad: { type: "string", description: "Nombre de la ciudad o municipio" },
                    direccion: { type: "string", description: "Dirección física exacta con barrio" },
                    info_adicional: { type: "string", description: "Referencias de llegada" },
                    cantidad_productos: { type: "number", description: "Cantidad de unidades (por defecto 1)" }
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
        console.log(`🧠 AI Context: Analyzing ${historyClean.length} previous msgs.`);

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...historyClean,
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.1, // Very low temp to be strict with data collection
            max_tokens: 350
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error.message);
        return { content: "Estamos experimentando alta demanda. ¿Me confirmas tu consulta?" };
    }
}