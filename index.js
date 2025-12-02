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

    try {
        const body = req.body;
        // DETECT LEAD STATUS CHANGE (Incoming)
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            
            // Check pipeline and status match
            if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS && 
                lead.status_id == process.env.STATUS_ID_ENTRANTES) {
                
                console.log(`🔔 Lead ${lead.id} detected in Incoming. Processing...`);
                await processLead(lead.id);
            }
        }
        
        // DETECT NEW LEAD (Creation)
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
             if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS) {
                 // Double check status if needed, or just process
                 await processLead(lead.id);
             }
        }

    } catch (err) {
        console.error('❌ Webhook Handler Error:', err);
    }
});

async function processLead(leadId) {
    try {
        const token = await getAccessToken();

        // 1. Get contact info
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        const contactId = leadRes.data._embedded.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact.");

        // 2. Mock Context (Later we fetch real chat)
        const context = []; 
        const incomingMessage = "Hola, me interesa info."; 

        // 3. Ask OpenAI
        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Handle Tools or Text
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 Saving Data:", args);
            await sendReply(contactId, "He guardado tus datos, gracias.", token);
            // Move to Despacho
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(contactId, aiResponse.content, token);
            // Move to Cualificando
            await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }
    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
    }
}

async function sendReply(contactId, text, token) {
    if (!text) return;
    try {
        const chatUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}/chats`;
        const chatRes = await axios.get(chatUrl, { headers: { Authorization: `Bearer ${token}` } });
        const chatId = chatRes.data._embedded?.chats?.[0]?.chat_id;

        if (chatId) {
            await axios.post(
                `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
                { text: text },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log("✅ Reply Sent to WhatsApp.");
        }
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
        console.log(`➡️ Lead moved to Status ${statusId}`);
    } catch (e) {
        console.error("❌ Status Change Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;

// 🔥 NEW: START SERVER AND CHECK AUTH IMMEDIATELY
app.listen(PORT, async () => {
    console.log(`🚀 Bot listening on port ${PORT}`);
    
    // Check Auth on Startup
    try {
        console.log("🔐 Checking Kommo connection...");
        await getAccessToken(); 
        console.log("✅ Kommo Connection Verified!");
    } catch (e) {
        console.error("❌ STARTUP ERROR: Could not connect to Kommo.", e.message);
    }
});