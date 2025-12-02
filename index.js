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
    // 📨 Instant 200 OK (Per Protocol 5.1 - High Availability)
    res.status(200).send('OK'); 
    
    // Log minimal info
    console.log("📨 Payload Received"); 

    try {
        const body = req.body;
        
        // 1. LEAD MOVED (Status Change)
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            // Ensure ID comparison matches string/int formats
            if (String(lead.status_id) === String(process.env.STATUS_ID_ENTRANTES)) {
                console.log(`🔔 Lead ${lead.id} moved to INCOMING. Processing...`);
                await processLead(lead.id);
            }
        }
        
        // 2. LEAD CREATED (New Message)
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

        // 1. Get Lead to find Contact ID
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        // Security Pipeline Check
        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log(`🛑 Wrong Pipeline. Got ${leadData.pipeline_id}`);
            return;
        }

        const contactId = leadData._embedded?.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact.");

        console.log(`👤 Contact ID: ${contactId}`);

        // 2. RETRIEVE CHAT ID (Implementing Gemini Protocol 3.1)
        const chatId = await getChatIdUsingDedicatedEndpoint(contactId, token);

        if (!chatId) {
            console.log("⚠️ CRITICAL: Chat ID not found even with dedicated endpoint.");
            return;
        }

        console.log(`💬 CHAT ID SECURED: ${chatId}`);

        // 3. OpenAI Processing
        const context = []; 
        const incomingMessage = "Hola (Lead Entrante)"; 
        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Send Reply & Move
        if (aiResponse.tool_calls) {
            await sendReply(chatId, "¡Datos guardados!", token);
            // Move Status
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(chatId, aiResponse.content, token);
            // Move Status
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (error) {
        console.error("❌ Logic Error:", error.message);
    }
}

// 🔥 THE GEMINI FIX (Protocol 3.1)
async function getChatIdUsingDedicatedEndpoint(contactId, token) {
    try {
        console.log(`🔎 Polling dedicated endpoint: /api/v4/contacts/chats?contact_id=${contactId}`);
        
        // This is the "Secret Weapon" endpoint
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/chats?contact_id=${contactId}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

        // Kommo returns an array of chat links
        const chatLinks = res.data._embedded?.chats;

        if (chatLinks && chatLinks.length > 0) {
            // Usually the first one is the active link. 
            // The Research confirms 'chat_id' (UUID) is here.
            return chatLinks[0].chat_id;
        }
    } catch (e) {
        console.log("❌ Failed to get Chat Links:", e.message);
    }
    return null;
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        // We use the Simple Structure. 
        // If this fails later, we will implement Protocol 4.3 (Complex Structure),
        // but for now, 90% of WhatsApp Lite integrations work with this.
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