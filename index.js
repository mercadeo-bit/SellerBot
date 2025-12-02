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
    res.status(200).send('OK'); // Always reply OK to Kommo fast

    try {
        const body = req.body;
        // console.log("📨 Payload:", JSON.stringify(body, null, 2)); // Enable for debugging

        // CHECK 1: Incoming Lead Status Change
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            
            // Check if pipeline matches VENTAS and Status is ENTRANTES
            if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS && 
                lead.status_id == process.env.STATUS_ID_ENTRANTES) {
                
                console.log(`🔔 Lead ${lead.id} detected in Incoming. Processing...`);
                await processLead(lead.id);
            }
        }
        
        // CHECK 2: New Lead (Optional, if you have webhooks on "add")
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            // If new leads land in Entrantes directly
             if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS) {
                 await processLead(lead.id);
             }
        }

    } catch (err) {
        console.error('❌ Webhook Handler Error:', err);
    }
});

async function processLead(leadId) {
    const token = await getAccessToken();

    // 1. Get contact info
    const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
    const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
    
    const contactId = leadRes.data._embedded.contacts?.[0]?.id;
    if (!contactId) return console.log("❌ Lead has no contact.");

    // 2. Fetch Chat History / Context (Mocked for now)
    // To make this real, we would fetch /api/v4/contacts/{id}/chats
    const context = []; 
    const incomingMessage = "Hola, me interesa info."; // Ideally fetch real last message

    // 3. Ask OpenAI
    const aiResponse = await analizarMensaje(context, incomingMessage);

    // 4. Handle Tools or Text
    if (aiResponse.tool_calls) {
        const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        console.log("💾 Saving Data:", args);
        
        // Update Custom Fields (Mapped to your vars)
        await updateFields(leadId, args, token);
        
        // Reply confirmation
        await sendReply(contactId, "¡Listo! He guardado tus datos de despacho. Procederemos...", token);
        
        // Move to Despacho or Won?
        await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
    } else {
        // Just text reply
        await sendReply(contactId, aiResponse.content, token);
        
        // Move to "Cualificando" (Next Stage)
        await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
    }
}

async function sendReply(contactId, text, token) {
    if (!text) return;
    try {
        // Find Chat ID
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

async function updateFields(leadId, data, token) {
    // Implement field update using FIELD_ID_CEDULA etc from your vars
    console.log("Update logic goes here using", process.env.FIELD_ID_CEDULA);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot listening on port ${PORT}`));