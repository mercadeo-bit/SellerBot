import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import qs from 'qs'; 
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    // 📨 Responder OK de inmediato
    res.status(200).send('OK'); 
    
    try {
        const body = req.body;
        
        // 🔍 RAYOS X: Imprimir todo lo que llegue para depurar
        console.log("📨 RAW PAYLOAD:", JSON.stringify(body, null, 2));

        // ------------------------------------------------------
        // EVENTO 1: MENSAJE ENTRANTE (Aquí está el Chat ID)
        // ------------------------------------------------------
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            console.log(`💬 MESSAGE EVENT DETECTED! ID: ${msg.chat_id}, Type: ${msg.type}`);

            // Solo respondemos a mensajes del cliente (incoming)
            if (msg.type === 'incoming') {
                // msg.entity_id suele ser el Lead ID en WhatsApp
                await processMessageEvent(msg.entity_id, msg.chat_id, msg.text);
            } else {
                console.log("Ignored: Message type is not incoming.");
            }
            return; // Ya procesamos, salimos.
        }

        // ------------------------------------------------------
        // EVENTO 2: LEAD CREADO (Solo informativo por ahora)
        // ------------------------------------------------------
        if (body.leads && body.leads.add) {
            console.log("🔔 Lead Created Event received. Waiting for Message Event...");
        }

    } catch (err) {
        console.error('❌ Webhook Handler Error:', err.message);
    }
});

async function processMessageEvent(leadId, chatId, messageText) {
    try {
        const token = await getAccessToken();

        // 1. Verificar Pipeline y Status
        // Necesitamos confirmar que el mensaje es de un lead en la columna correcta
        // A veces entity_id en mensajes es el Lead ID. Validemos.
        let leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
        
        // Si leadId falla (a veces es contact_id), intentamos resolverlo
        // Pero primero probemos directo:
        try {
            const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
            const leadData = leadRes.data;

            // Filtros de Seguridad
            if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
                console.log(`🛑 Message ignored: Lead in wrong pipeline (${leadData.pipeline_id}).`);
                return;
            }
            
            // Verifica que esté en "Entrada / Nuevo Lead" (o la columna que desees)
            if (String(leadData.status_id) !== String(process.env.STATUS_ID_ENTRANTES)) {
                console.log(`🛑 Message ignored: Status is ${leadData.status_id}. Waiting for ${process.env.STATUS_ID_ENTRANTES}.`);
                return;
            }

        } catch (error) {
            console.log("⚠️ Could not fetch Lead info from entity_id. Is this a Contact ID?", error.message);
            // Si quieres que responda igual aunque falle la verificación, comenta el return.
            // return; 
        }

        console.log(`✅ AI ACTIVATED for Chat ${chatId}`);

        // 2. Procesar con IA
        // (Aquí podrías pasar historial previo si lo tuvieras)
        const context = []; 
        const aiResponse = await analizarMensaje(context, messageText);

        // 3. Responder
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 AI Tool Args:", args);
            await sendReply(chatId, "Recibido. Un asesor validará la información.", token);
            // Lógica de cambio de estado (Opcional)
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);

        } else {
            await sendReply(chatId, aiResponse.content, token);
            // Mover a "Cualificando"
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (error) {
        console.error("❌ Logic Error:", error.message);
    }
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        console.log(`📤 Sending to ${chatId}...`);
        await axios.post(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ REPLY SENT SUCCESS!`);
    } catch (e) {
        console.error("❌ Send Failed:", e.response?.data || e.message);
    }
}

async function changeStatus(leadId, statusId, token) {
    try {
        await axios.patch(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`,
            { status_id: parseInt(statusId) },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`➡️ Status Updated to ${statusId}`);
    } catch (e) {
        console.error("❌ Status Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Auth Ready"); } catch (e) {}
});