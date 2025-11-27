import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

console.log("--------------- INICIO SISTEMA DE VENTAS ---------------");

// 1. Configuración Express
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

// 2. Configuración OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 3. Herramientas (Function Calling)
const tools = [
  {
    type: "function",
    function: {
      name: "guardar_datos_envio",
      description: "Guarda la dirección y datos de envío del cliente para despacho.",
      parameters: {
        type: "object",
        properties: {
          ms_direccion_exacta: { type: "string", description: "Dirección completa (Calle, barrio, ciudad)" },
          ms_documento_numero: { type: "string", description: "Cédula o NIT" },
          ms_ciudad: { type: "string", description: "Ciudad de destino" }
        },
        required: ["ms_direccion_exacta", "ms_documento_numero"]
      }
    }
  }
];

// 4. Webhook Principal
app.post('/webhook', async (req, res) => {
    try {
        // Responder rápido a Kommo para evitar timeouts
        res.status(200).send('OK');

        // Extraer datos con seguridad
        let lead_id = null;
        let mensaje_cliente = null;

        if (req.body.message && req.body.message.add && req.body.message.add.length > 0) {
            const data = req.body.message.add[0];
            lead_id = data.lead_id;
            mensaje_cliente = data.text;
        }

        // Si no es un mensaje válido, paramos aquí (silenciosamente)
        if (!lead_id || !mensaje_cliente) return;

        console.log(`📩 Cliente (Lead ${lead_id}) dice: "${mensaje_cliente}"`);

        // Llamar a la IA
        const completion = await openai.chat.completions.create({
            model: "gpt-4", // Usamos GPT-4 para mejor venta
            messages: [
                { role: "system", content: "Eres el vendedor experto de Ferretería Copacol. Tu meta es vender productos (Tubería, Herramientas, etc). Eres amable, técnico y vas al grano. SI EL CLIENTE CONFIRMA COMPRA: Pide dirección y cédula. NO inventes precios (si no sabes di 'cotizaré')." },
                { role: "user", content: mensaje_cliente }
            ],
            tools: tools,
            tool_choice: "auto",
        });

        const respuesta_ia = completion.choices[0].message;

        // Decidir Acción
        if (respuesta_ia.tool_calls) {
            console.log("🛠️ CLIENTE QUIERE COMPRAR - Guardando datos...");
            const args = JSON.parse(respuesta_ia.tool_calls[0].function.arguments);
            
            // Guardar en Kommo
            await actualizarKommo(lead_id, args);
            await moverLead(lead_id);
            await agregarNota(lead_id, "✅ IA: Datos guardados y pedido listo para despacho.");
            
        } else {
            console.log(`💬 RESPUESTA IA: "${respuesta_ia.content}"`);
            // Escribir la respuesta como nota interna (o conectar API Chat si tuviéramos Chat ID)
            await agregarNota(lead_id, `🤖 Sugerencia IA: ${respuesta_ia.content}`);
        }

    } catch (error) {
        console.error("❌ Error procesando mensaje:", error.message);
    }
});

// 5. Funciones Auxiliares
async function actualizarKommo(lead_id, datos) {
    try {
        const custom_fields = [];
        // Mapeo seguro usando las variables de entorno
        if (datos.ms_direccion_exacta && process.env.FIELD_ID_DIRECCION) 
            custom_fields.push({ field_id: Number(process.env.FIELD_ID_DIRECCION), values: [{ value: datos.ms_direccion_exacta }] });
        
        if (datos.ms_documento_numero && process.env.FIELD_ID_CEDULA) 
            custom_fields.push({ field_id: Number(process.env.FIELD_ID_CEDULA), values: [{ value: datos.ms_documento_numero }] });

        if (custom_fields.length > 0) {
            await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`, 
                { custom_fields_values: custom_fields },
                { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
            );
        }
    } catch (e) { console.error("Error Kommo Update:", e.response?.data || e.message); }
}

async function moverLead(lead_id) {
    try {
        if (!process.env.PIPELINE_ID_VENTAS || !process.env.STATUS_ID_DESPACHO) return;
        await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`, 
            { 
                pipeline_id: Number(process.env.PIPELINE_ID_VENTAS), 
                status_id: Number(process.env.STATUS_ID_DESPACHO) 
            },
            { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
        );
    } catch (e) { console.error("Error Kommo Move:", e.message); }
}

async function agregarNota(lead_id, texto) {
    try {
        await axios.post(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}/notes`,
            [ { note_type: "common", params: { text: texto } } ],
            { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
        );
    } catch (e) { console.error("Error Nota:", e.message); }
}

// 6. Arrancar Servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 COPACOL AI listo y escuchando en puerto ${PORT}`);
});