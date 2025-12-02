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
    res.status(200).send('OK'); 
    console.log("📨 Payload Received"); 

    try {
        const body = req.body;
        
        // 1. LEAD MOVED (Status Change)
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            if (String(lead.status_id) === String(process.env.STATUS_ID_ENTRANTES)) {
                console.log(`🔔 Lead ${lead.id} moved to INCOMING. Processing...`);
                await processLead(lead.id);
            }
        }
        
        // 2. LEAD CREATED
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            if (lead.id) {
                console.log(`🔔 New Lead ${lead.id} detected. Processing...`);
                await processLead(lead.id);
            }
        }

    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processLead(leadId) {
    try {
        const token = await getAccessToken();

        // 1. Get Lead and Contact
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log(`🛑 Wrong Pipeline. Got ${leadData.pipeline_id}`);
            return;
        }

        const contactId = leadData._embedded?.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact attached.");
        console.log(`👤 Contact ID: ${contactId}`);

        // 2. RETRIEVE CHAT ID (STRATEGY D: FILTER TALKS)
        const chatId = await findChatViaTalks(contactId, token);

        if (!chatId) {
            console.log("⚠️ CRITICAL: No conversations found for this contact.");
            return;
        }

        console.log(`💬 CHAT ID SECURED: ${chatId}`);

        // 3. AI Processing
        const context = []; 
        const incomingMessage = "Hola (Trigger automático)"; 
        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Send Reply
        if (aiResponse.tool_calls) {
            await sendReply(chatId, "¡Datos guardados!", token);
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(chatId, aiResponse.content, token);
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
    }
}

// 🔥 STRATEGY D: Filter Talks by Entity
async function findChatViaTalks(contactId, token) {
    try {
        // Query the "Talks" endpoint asking: "Give me conversations linked to this contact"
        console.log(`🔎 Polling /api/v4/talks for contact ${contactId}...`);
        
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks?filter[entity_type]=contact&filter[entity_id]=${contactId}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

        const talks = res.data._embedded?.talks;

        if (talks && talks.length > 0) {
            // Talk objects contain the 'chat_id' (UUID) we need
            // usually in talks[0].chat_id
            const chatUUID = talks[0].chat_id;
            console.log(`✅ FOUND Chat ID via Talks: ${chatUUID}`);
            return chatUUID;
        } else {
            console.log("⚠️ /api/v4/talks returned empty list. No active conversation.");
        }
    } catch (e) {
        console.log("❌ Failed polling Talks:", e.response?.data || e.message);
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
        console.log(`✅ Message SENT to ${chatId}`);
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
        console.log(`➡️ Moved to Status ${statusId}`);
    } catch (e) {
        console.error("❌ Status Change Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});