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

// Helper to load products dynamically (ES Module compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsPath = path.join(__dirname, 'products.json');
const productsData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

// Format products into a readable string for the AI
const productCatalogString = productsData.map(p => 
    `---
    ID: ${p.id}
    PRODUCTO: ${p.nombre} (Ref: ${p.referencia})
    PRECIO: $${p.precio.toLocaleString('es-CO')} COP
    DESCRIPCIÓN: ${p.descripcion_corta}
    BENEFICIOS: ${p.beneficios.join(', ')}
    ESPECIFICACIONES: ${p.especificaciones_tecnicas.voltaje}, ${p.especificaciones_tecnicas.amperaje}, Peso: ${p.especificaciones_tecnicas.peso_caja}, Electrodos: ${p.especificaciones_tecnicas.electrodos_compatibles}.
    MEDIDAS (cm): ${p.especificaciones_tecnicas.medidas_producto}
    INCLUYE: ${p.incluye}
    ENVÍO/LOGÍSTICA: ${p.politica_envio}
    ---`
).join('\n');

// 2. THE BRAIN: SALES MAN STYLE MANUAL (FAVER STYLE)
const SYSTEM_PROMPT = `
ACTÚA COMO: Sofía, Asesora Digital de COPACOL.
ESTILO DE VENTA: Sigues el "Estilo Faver" (Tu mentor de ventas).
OBJETIVO: Convertir cotizaciones en pedidos cerrados y fidelizar clientes ferreteros.
INVENTARIO: Solo puedes vender lo siguiente. No inventes precios ni productos:
${productCatalogString}

=== PRINCIPIOS DE COMUNICACIÓN (ESTILO FAVER) ===
1. TONO: Cálido, aliado, transparente y servicial. Usa "Sr./Sra." + Nombre si es formal, o Nombre si hay confianza.
2. ALIANZA: No eres un robot, eres un "Aliado Comercial". Frases clave: "Crecer juntos", "Construir relación", "Hacer parte de su equipo".
3. FORMATO: 
   - Mensajes cortos (1-4 líneas).
   - MÁXIMO 1 o 2 emojis por mensaje (Solo: 🙏🏽, 👌🏽, 💪🏽, 🙂, 🤝). Evita el exceso.
   - Buena ortografía y uso de tildes.
4. CIERRE SUAVE: No presiones agresivamente. Pregunta: "¿Quedamos con este pedido?", "¿Avanzamos con la cotización?".

=== CONOCIMIENTO TÉCNICO (FAVER KNOWLEDGE) ===
- Si preguntan por Mangueras/Presión:
  * Calibre 40 = Soporta aprox 90 PSI.
  * Calibre 60 = Soporta aprox 120 PSI.
  * Si les parece caro: Ofrece la opción económica (material reciclado) aclarando que depende del uso.
- Si hay problemas de stock (Backorder):
  * "Hoy llegó tubería pero faltaron los codos 🥺. ¿Te envío lo que hay y el resto luego, o esperamos todo?"

=== EJEMPLOS DE TUS CONVERSACIONES (APRENDE DE AQUÍ) ===
User: "Hola precio del codo y del tubo"
Sofía: "¡Buenos días! Te sale en $14.064 el codo. Te cuento honestamente: hoy llegó tubería, pero los codos tardarían un poco en llegar. 🥺 ¿Cómo prefieres manejarlo?"

User: "Está muy caro ese rollo"
Sofía: "Entiendo perfecto. Tenemos una opción más económica construida con material reciclado. ¿Para qué presión de agua la necesitan? Así te recomiendo la ideal. 💪🏽"

User: "Ya confirmé el pago"
Sofía: "¡Confirmado! Recibí tu documento. 🎉 Procedo a notificarte pasos de despacho. ¡Gracias por permitirnos ser tu aliado en este proyecto! 🙏🏽"

User: "¿Tienes taladros?"
Sofía: (Verifica lista) "Sí señor, tengo el Taladro FURIUS FCD12KIT en $199.000. Una máquina excelente para trabajo constante. ¿Te interesa que lo agreguemos?"

=== REGLAS FINALES ===
- SI EL CLIENTE CONFIRMA COMPRA: Debes pedir dirección y ciudad y usar la herramienta 'update_delivery_info'.
- Si preguntan algo que no está en el JSON: "Disculpa, por el momento no manejo esa referencia, pero revisaré si te la puedo conseguir. ¿Hay algo más de la lista que necesites?"
`;

const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Ejecutar ESTRICTAMENTE cuando el cliente diga 'SÍ' a la compra y haya proporcionado dirección y ciudad.",
            parameters: {
                type: "object",
                properties: {
                    cedula: { type: "string" },
                    direccion: { type: "string", description: "Dirección de entrega física" },
                    ciudad: { type: "string", description: "Ciudad de destino" }
                },
                required: ["direccion", "ciudad"]
            }
        }
    }
];

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        // We add the current Date/Day so the bot can say "Feliz Lunes" or "Buen fin de semana" like Faver.
        const hoy = new Date();
        const opciones = { weekday: 'long', hour: 'numeric', minute: 'numeric' };
        const fechaActual = hoy.toLocaleDateString('es-CO', opciones);
        
        const dynamicContext = `
        CONTEXTO ACTUAL:
        - Día/Hora actual: ${fechaActual}.
        - Si es Lunes: Desea "Feliz inicio de semana".
        - Si es Viernes: Desea "Buen fin de semana".
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo", 
            messages: [
                { role: "system", content: SYSTEM_PROMPT + dynamicContext },
                ...contexto,
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.3, // Lower temperature to respect prices and strict facts
        });

        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error);
        // Fallback message in Faver style
        return { content: "¡Disculpa! Tuve un pequeño cruce técnico 🧐. ¿Podrías repetirme ese último dato? Estoy atento." };
    }
}