import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Variable global para recordar el dominio correcto (amocrm.com vs kommo.com)
let apiDomain = process.env.KOMMO_SUBDOMAIN + '.kommo.com';

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        // 🕵️ DETECTAR DOMINIO AUTOMÁTICAMENTE
        // Si Kommo nos dice que su link es amocrm.com, usamos ese.
        if (body.account && body.account._links && body.account._links.self) {
            const selfUrl = body.account._links.self; // Ej: https://sub.amocrm.com
            // Extraer el dominio limpio (sub.amocrm.com)
            const domainMatch = selfUrl.match(/https?:\/\/([^\/]+)/);
            if (domainMatch && domainMatch[1]) {
                apiDomain = domainMatch[1];
                console.log(`🌍 API Domain synced to: ${apiDomain}`);
            }
        }

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
        // ESTRATEGIA 2: LEAD CREADO (Plan B - Notas)
        // ------------------------------------------------------
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            console.log(`🔔 LEAD CREATED: ${lead.id}. Waiting to verify type...`);

            // Esperar a que se guarde la nota del mensaje inicial
            await sleep(3000);
            
            const result = await getChatDataFromNotes(lead.id);
            if (result && result.chatId) {
                console.log(`✅ FOUND CHAT ID IN NOTES: ${result.chatId}`);
                await processReply(lead.id, result.chatId, result.text || "Hola");
            } else {
                console.log("⚠️ No chat_id in notes yet. (Maybe manually created?)");
            }
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
});

async function processReply(leadId, chatId, incomingText) {
    try {
        const token = await getAccessToken();

        // 1. Obtener datos del Lead para verificar Status/Pipeline
        // Usamos apiDomain dinámico
        const leadRes = await axios.get(`https://${apiDomain}/api/v4/leads/${leadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const leadData = leadRes.data;

        // OJO: Si quieres activar filtro de status, descomenta esto:
        /*
        if (String(leadData.status_id) !== String(process.env.STATUS_ID_ENTRANTES)) {
            console.log(`🛑 Status ${leadData.status_id} incorrect. Ignoring.`);
            return;
        }
        */

        console.log(`🤖 AI Thinking...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);

        // Responder
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 Saving Data:", args);
            await sendReply(chatId, "¡Datos recibidos! Gracias.", token);
            // Move Status
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(chatId, aiResponse.content, token);
            // Move Status
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (e) {
        console.error("❌ Process Logic Error:", e.message);
    }
}

async function getChatDataFromNotes(leadId) {
    try {
        const token = await getAccessToken();
        const url = `https://${apiDomain}/api/v4/leads/${leadId}/notes`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        const notes = res.data._embedded?.notes || [];
        for (const note of notes.reverse()) {
            if (note.params && note.params.chat_id) {
                return { chatId: note.params.chat_id, text: note.params.text };
            }
        }
    } catch (e) {}
    return null;
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        console.log(`📤 Sending via ${apiDomain}...`);
        
        // 💡 FIX 404: Usar el dominio dinámico correcto (amocrm.com vs kommo.com)
        await axios.post(
            `https://${apiDomain}/api/v4/talks/chats/${chatId}/messages`,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ MESSAGE SENT SUCCESS! 🚀`);
    } catch (e) {
        console.error("❌ Send Failed:", e.response?.data || e.message);
        
        // Retry logic: Si falló con amocrm, intenta forzar kommo (o viceversa) como último recurso
        if (e.response && e.response.status === 404) {
            console.log("🔄 Retrying with fallback domain...");
            // Toggle domain simple para reintento
            const fallbackDomain = apiDomain.includes('amocrm') 
                ? apiDomain.replace('amocrm', 'kommo') 
                : apiDomain.replace('kommo', 'amocrm');
                
            try {
                await axios.post(
                    `https://${fallbackDomain}/api/v4/talks/chats/${chatId}/messages`,
                    { text: text },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                console.log(`✅ RETRY SENT SUCCESS!`);
            } catch (err2) {
                 console.error("❌ Retry also failed.");
            }
        }
    }
}

async function changeStatus(leadId, statusId, token) {
    try {
        await axios.patch(
            `https://${apiDomain}/api/v4/leads/${leadId}`,
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