import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

// --- CONFIGURACIÓN ---
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN; // Tu token largo
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// --- DEFINICIÓN DE HERRAMIENTAS (Function Calling) ---
const tools = [
  {
    type: "function",
    function: {
      name: "guardar_datos_envio",
      description: "Guarda la dirección y datos de envío del cliente cuando confirma la compra.",
      parameters: {
        type: "object",
        properties: {
          ms_direccion_exacta: { type: "string", description: "Dirección completa (Calle, carrera, barrio, ciudad)" },
          ms_documento_numero: { type: "string", description: "Número de cédula o NIT" },
          ms_ciudad: { type: "string", description: "Ciudad de destino" }
        },
        required: ["ms_direccion_exacta", "ms_documento_numero"]
      }
    }
  }
];

// --- RUTA WEBHOOK ---
app.post('/webhook', async (req, res) => {
    try {
        console.log("📩 Webhook recibido");

        // 1. Extraer datos (Compatible con Kommo)
        let lead_id = null;
        let mensaje_cliente = null;
        let chat_id = null;

        if (req.body.message && req.body.message.add && req.body.message.add.length > 0) {
            const data = req.body.message.add[0];
            lead_id = data.lead_id;
            mensaje_cliente = data.text;
            chat_id = data.chat_id;
        } else if (req.body.leads && req.body.leads.add) {
             console.log("Ignorando webhook de creación de lead (no es mensaje)");
             return res.status(200).send('OK');
        }

        if (!lead_id || !mensaje_cliente) {
            console.log("⚠️ No se detectó mensaje de usuario o ID válido.");
            return res.status(200).send('Ignored');
        }

        console.log(`👤 Lead: ${lead_id} dice: "${mensaje_cliente}"`);

        // 2. Consultar a OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", // O "gpt-3.5-turbo" si prefieres
            messages: [
                { role: "system", content: "Eres Copacol AI, un experto en ferretería (marcas Tigre, Bellota). Tu objetivo es vender. Si el cliente quiere comprar, pide dirección y cédula. Se amable y técnico." },
                { role: "user", content: mensaje_cliente }
            ],
            tools: tools,
            tool_choice: "auto",
        });

        const respuesta_ia = completion.choices[0].message;

        // 3. Ejecutar Lógica
        if (respuesta_ia.tool_calls) {
            console.log("🛠️ IA quiere guardar datos.");
            const args = JSON.parse(respuesta_ia.tool_calls[0].function.arguments);
            
            // Actualizar Kommo
            await actualizarKommo(lead_id, args);
            await moverLead(lead_id);
            
            // Confirmar (Opcional, esto imprime en log por ahora)
            console.log("✅ Datos guardados. Pedido listo.");
        } else {
            console.log(`💬 IA responde texto: "${respuesta_ia.content}"`);
            // AQUÍ ENVIARÍAS EL MENSAJE DE VUELTA A WHATSAPP
            // (Para esta versión, si quieres enviar texto real, necesitarías la API de Chat, 
            // pero vamos a dejar que Kommo gestione la charla o agregar nota).
            await agregarNota(lead_id, `🤖 IA Sugiere responder: ${respuesta_ia.content}`);
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error("❌ Error en servidor:", error);
        res.status(500).send('Error');
    }
});

// --- FUNCIONES DE CONEXIÓN KOMMO ---

async function actualizarKommo(lead_id, datos) {
    try {
        const custom_fields = [];
        // Mapeo manual de IDs (Asegúrate que estas ENV existan en Railway)
        if (datos.ms_direccion_exacta) custom_fields.push({ field_id: Number(process.env.FIELD_ID_DIRECCION), values: [{ value: datos.ms_direccion_exacta }] });
        if (datos.ms_documento_numero) custom_fields.push({ field_id: Number(process.env.FIELD_ID_CEDULA), values: [{ value: datos.ms_documento_numero }] });

        if (custom_fields.length > 0) {
            await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`, 
                { custom_fields_values: custom_fields },
                { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
            );
        }
    } catch (e) { console.error("Error actualizando Kommo", e.message); }
}

async function moverLead(lead_id) {
    try {
        await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`, 
            { 
                pipeline_id: Number(process.env.PIPELINE_ID_VENTAS), 
                status_id: Number(process.env.STATUS_ID_DESPACHO) 
            },
            { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
        );
    } catch (e) { console.error("Error moviendo Lead", e.message); }
}

async function agregarNota(lead_id, texto) {
    try {
        await axios.post(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}/notes`,
            [ { note_type: "common", params: { text: texto } } ],
            { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } }
        );
    } catch (e) { console.error("Error creando nota", e.message); }
}

// --- SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Copacol AI listo en puerto ${PORT}`);
});