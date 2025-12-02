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

// Ruta de salud
app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    // 📨 Responder rápido a Kommo para evitar timeouts
    res.status(200).send('OK'); 
    
    // Log para confirmar recepción
    console.log("📨 Payload Received"); 

    try {
        const body = req.body;
        
        // DETECTOR 1: CAMBIO DE ESTADO (Arrastrar Lead)
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            // Verificar si entró al estado deseado
            if (String(lead.status_id) === String(process.env.STATUS_ID_ENTRANTES)) {
                console.log(`🔔 Lead ${lead.id} moved to INCOMING. Starting process...`);
                await processLead(lead.id);
            }
        }
        
        // DETECTOR 2: LEAD CREADO (Nuevo mensaje entrante)
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            // Solo si tiene ID (asumiendo que el webhook está filtrado por columna en Kommo)
            if (lead.id) {
                console.log(`🔔 New Lead ${lead.id} detected. Starting process...`);
                await processLead(lead.id);
            }
        }

    } catch (err) {
        console.error('❌ Webhook Handler Error:', err.message);
    }
});

async function processLead(leadId) {
    try {
        const token = await getAccessToken();

        // 1. Obtener datos del Lead
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        // Verificar Pipeline
        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log(`🛑 Wrong Pipeline. Got ${leadData.pipeline_id}, expected ${process.env.PIPELINE_ID_VENTAS}`);
            return;
        }

        const contactId = leadData._embedded?.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact attached.");

        console.log(`👤 Contact ID Found: ${contactId}`);

        // 2. BUSCAR EL CHAT ID (TRIPLE ESTRATEGIA)
        const chatId = await findChatId(contactId, leadId, token);

        if (!chatId) {
            console.log("⚠️ CRITICAL: Could not find Chat ID. The bot cannot reply.");
            return;
        }

        // 3. Inteligencia Artificial (TODO: Pasar historial real en el futuro)
        const context = []; 
        const incomingMessage = "Hola (Trigger automático de estado)"; 

        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Responder y Mover
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 Saving Data:", args);
            
            await sendReply(chatId, "¡Datos recibidos! Procederemos con el despacho.", token);
            
            if(process.env.STATUS_ID_DESPACHO) {
                await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
            }
        } else {
            console.log(`🤖 AI sending reply...`);
            await sendReply(chatId, aiResponse.content, token);
            
            // Mover a etapa "Cualificando" para evitar bucles
            if(process.env.STATUS_ID_CUALIFICANDO) {
                await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
            }
        }

    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
    }
}

// 🔥 FUNCIÓN DE BÚSQUEDA MEJORADA (NOTES + EVENTS)
async function findChatId(contactId, leadId, token) {
    
    // ESTRATEGIA A: Preguntar al Contacto directamente
    try {
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}?with=chats`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data._embedded?.chats?.length > 0) {
            const id = res.data._embedded.chats[0].chat_id;
            console.log(`✅ Found Chat ID via Contact: ${id}`);
            return id;
        }
    } catch(e) {}

    // ESTRATEGIA C (NUEVA): Buscar en las NOTAS del Lead (Mensajes = Notas)
    try {
        console.log("🔎 Hunting Chat ID via Lead Notes...");
        // Buscamos notas tipo 'service_message' o 'common' que contengan info del chat
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        const notes = res.data._embedded?.notes || [];
        
        // Iteramos buscando params que parezcan un chat_id (formato UUID o largo)
        for (const note of notes) {
            if (note.params) {
                // Estructura común en WhatsApp Lite/Official
                if (note.params.chat_id) return note.params.chat_id;
                if (note.params.thread_id) return note.params.thread_id;
                
                // A veces viene dentro de 'metadata' o 'service' en el texto
            }
        }
    } catch(e) { console.log("Failed Strategy C"); }

    // ESTRATEGIA B (FIXED): Historial de Eventos (Sin filtro type que daba 400)
    try {
        console.log("🔎 Hunting Chat ID via Lead Events (Deep Search)...");
        // Quitamos filter[type] para evitar error 400. Traemos TODO y filtramos aquí.
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        const events = res.data._embedded?.events || [];
        for (const ev of events) {
            // Buscamos eventos de mensaje entrante (type: incoming_chat_message o similar)
            if (ev.type === 'incoming_chat_message' || ev.type === 'chat_message') {
                if (ev.value_after?.chat_id) {
                    console.log(`✅ Found Chat ID via Event: ${ev.value_after.chat_id}`);
                    return ev.value_after.chat_id;
                }
            }
            // Revisamos metadata genérica por si acaso
            if (ev.value_after?.link && ev.value_after.link.includes('chat_id')) {
                // A veces viene en un link interno
            }
        }
    } catch(e) { console.log("Failed Strategy B"); }

    return null;
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        console.log(`💬 Attempting to send to Chat: ${chatId}`);
        await axios.post(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ Message SENT successfully.`);
    } catch (e) {
        console.error("❌ Send Message Error:", e.response?.data || e.message);
    }
}

async function changeStatus(leadId, statusId, token) {
    try {
        await axios.patch(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`,
            { status_id: parseInt(statusId) },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`➡️ Lead ${leadId} moved to Status ID ${statusId}`);
    } catch (e) {
        console.error("❌ Status Change Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot listening on port ${PORT}`);
    try {
        await getAccessToken(); 
        console.log("✅ Kommo Connection Verified!");
    } catch (e) {
        console.error("❌ STARTUP ERROR:", e.message);
    }
});