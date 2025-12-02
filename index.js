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
    // 📨 Log rápido para confirmar que llegó algo
    console.log("📨 Payload Received"); 
    res.status(200).send('OK'); 

    try {
        const body = req.body;
        
        // DETECTOR 1: CAMBIO DE ESTADO
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            if (String(lead.status_id) === String(process.env.STATUS_ID_ENTRANTES)) {
                console.log(`🔔 Lead ${lead.id} moved to INCOMING. Starting process...`);
                await processLead(lead.id);
            }
        }
        
        // DETECTOR 2: LEAD CREADO
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            // Procesamos si viene con ID (asumimos que el webhook está en la columna correcta)
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

        // 1. Obtener datos del Lead y Contacto
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        // Verificar Pipeline (usamos String para evitar errores de tipo número/texto)
        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log(`🛑 Wrong Pipeline. Got ${leadData.pipeline_id}, expected ${process.env.PIPELINE_ID_VENTAS}`);
            return;
        }

        const contactId = leadData._embedded?.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact attached.");

        console.log(`👤 Contact ID Found: ${contactId}`);

        // 2. BUSCAR EL CHAT ID (ESTRATEGIA DOBLE)
        // Intento A: Preguntar al contacto
        // Intento B: Buscar en eventos del lead (Backdoor)
        
        const chatId = await findChatId(contactId, leadId, token);

        if (!chatId) {
            console.log("⚠️ CRITICAL: Could not find ANY Chat ID for this lead. Is it a real WhatsApp lead?");
            return;
        }

        // 3. Inteligencia Artificial
        const context = []; // TODO: Historial
        const incomingMessage = "Hola (Trigger automático)"; 

        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Responder
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 Saving Data:", args);
            
            await sendReply(chatId, "¡Datos recibidos! Un asesor te contactará.", token);
            
            if(process.env.STATUS_ID_DESPACHO) {
                await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
            }
        } else {
            await sendReply(chatId, aiResponse.content, token);
            
            // Mover etapa
            if(process.env.STATUS_ID_CUALIFICANDO) {
                await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
            }
        }

    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
        if (error.response) console.error("API Error Detail:", error.response.data);
    }
}

// 🔥 LA NUEVA FUNCIÓN BUSCADORA
async function findChatId(contactId, leadId, token) {
    // ESTRATEGIA A: Contacto directo
    try {
        console.log("🔎 Hunting Chat ID via Contact...");
        const chatUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}?with=chats`;
        const res = await axios.get(chatUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        if (res.data._embedded?.chats?.length > 0) {
            const id = res.data._embedded.chats[0].chat_id;
            console.log(`✅ Found Chat ID via Contact: ${id}`);
            return id;
        }
    } catch(e) { console.log("Failed Strategy A"); }

    // ESTRATEGIA B: Historial de Eventos (Plan B)
    try {
        console.log("🔎 Hunting Chat ID via Lead Events...");
        // Buscamos eventos de "Mensaje entrante" (incoming_chat_message)
        const eventUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&filter[type]=chat_message`;
        const res = await axios.get(eventUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // Buscamos cualquier evento que tenga chat_id en sus valores
        const events = res.data._embedded?.events || [];
        for (const ev of events) {
            // A veces está en value, a veces en meta
            if (ev.value_after && ev.value_after.chat_id) return ev.value_after.chat_id;
            if (ev.value_before && ev.value_before.chat_id) return ev.value_before.chat_id;
            
            // Log para debuggear eventos si falla
            // console.log("Event:", JSON.stringify(ev, null, 2));
        }
    } catch(e) { console.log("Failed Strategy B", e.message); }

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
        console.log(`✅ Message Sent to Chat ${chatId}`);
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