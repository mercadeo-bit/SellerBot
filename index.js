import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helpers de espera
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK'); // Responder siempre OK rápido

    try {
        const body = req.body;
        // Imprimir raw para debug
        // console.log("📨 Payload:", JSON.stringify(body, null, 2));

        // ------------------------------------------------------
        // ESTRATEGIA 1: MENSAJE DIRECTO (La mejor opción)
        // ------------------------------------------------------
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`💬 MESSAGE EVENT: ${msg.chat_id}`);
                await processReply(msg.entity_id, msg.chat_id, msg.text);
                return;
            }
        }

        // ------------------------------------------------------
        // ESTRATEGIA 2: LEAD CREADO (El Plan B robusto)
        // ------------------------------------------------------
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            const leadId = lead.id;
            console.log(`🔔 LEAD CREATED: ${leadId}. Hunting for Chat ID...`);

            // Esperar 3 segundos a que Kommo guarde la nota del mensaje
            await sleep(3000);

            // Buscar el Chat ID en las notas
            const result = await getChatDataFromNotes(leadId);
            
            if (result && result.chatId) {
                console.log(`✅ FOUND CHAT ID IN NOTES: ${result.chatId}`);
                const textoMensaje = result.text || "Hola (Nuevo Lead)";
                await processReply(leadId, result.chatId, textoMensaje);
            } else {
                console.log("⚠️ Could not find chat_id in Lead Notes.");
            }
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
});

// Lógica Principal de Respuesta
async function processReply(leadId, chatId, incomingText) {
    try {
        const token = await getAccessToken();

        // Verificar Filtros (Pipeline, Estado)
        const leadRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const leadData = leadRes.data;

        // Opcional: Validar Pipeline (Si quieres responder a TODOS, comenta esto)
        /*
        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log("🛑 Wrong Pipeline. Ignoring.");
            return;
        }
        */

        console.log(`🤖 AI Thinking for Chat ${chatId}...`);
        
        // Consultar OpenAI
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);

        // Responder
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 Saving Data:", args);
            await sendReply(chatId, "¡Datos recibidos! Gracias.", token);
            // Mover
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(chatId, aiResponse.content, token);
            // Mover a Cualificando
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (e) {
        console.error("❌ Process Reply Error:", e.message);
    }
}

// 🕵️ CAZADOR DE NOTAS (Recupera Chat ID de los metadatos)
async function getChatDataFromNotes(leadId) {
    try {
        const token = await getAccessToken();
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        const notes = res.data._embedded?.notes || [];
        
        // Buscar en orden cronológico inverso (última nota primero)
        for (const note of notes.reverse()) {
            // Nota tipo: Mensaje Entrante
            if (note.note_type === 'message_in' || note.note_type === 4) {
                // A veces está en params
                if (note.params && note.params.chat_id) {
                    return { chatId: note.params.chat_id, text: note.params.text };
                }
            }
            // Buscar en Service Message (common)
            if (note.params && (note.params.service === 'WhatsApp' || note.params.service === 'com.amocrm.amocrmwa')) {
               if (note.params.chat_id) return { chatId: note.params.chat_id, text: "Nuevo mensaje" };
            }
        }
    } catch (e) {
        console.log("❌ Notes Hunt Failed:", e.message);
    }
    return null;
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        await axios.post(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ MESSAGE SENT!`);
    } catch (e) {
        console.error("❌ Send Failed:", e.message);
    }
}

async function changeStatus(leadId, statusId, token) {
    try {
        await axios.patch(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`,
            { status_id: parseInt(statusId) },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`➡️ Status Moved.`);
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});