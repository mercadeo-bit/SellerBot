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
    // 📨 Ack fast
    res.status(200).send('OK'); 
    
    try {
        const body = req.body;
        console.log("📨 Webhook Event Received");

        // 🔥 EVENT: INCOMING MESSAGE (The Golden Key)
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            
            // Only reply to Incoming messages (Not our own)
            if (msg.type === 'incoming') {
                console.log(`💬 Incoming Message detected from Chat: ${msg.chat_id}`);
                
                // msg.entity_id is usually the Lead ID
                await processMessageEvent(msg.entity_id, msg.chat_id, msg.text);
            }
        }

        // Keep "Lead Added" as fallback if needed, but Message is better
        if (body.leads && body.leads.add) {
            console.log("🔔 Lead Created Event (Ignored in favor of Message Event)");
        }

    } catch (err) {
        console.error('❌ Webhook Handler Error:', err.message);
    }
});

async function processMessageEvent(leadId, chatId, messageText) {
    try {
        const token = await getAccessToken();

        // 1. Verify Lead Status/Pipeline (Gatekeeper)
        // We only want to reply if the lead is in the specific column
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        // Check Pipeline
        if (String(leadData.pipeline_id) !== String(process.env.PIPELINE_ID_VENTAS)) {
            console.log(`🛑 Message ignored: Lead is in wrong pipeline.`);
            return;
        }

        // Check Status (Only reply if in "Entrada" or "Incoming")
        // If you want it to reply in ANY column, remove this check.
        if (String(leadData.status_id) !== String(process.env.STATUS_ID_ENTRANTES)) {
            console.log(`🛑 Message ignored: Lead Status is ${leadData.status_id}, expected ${process.env.STATUS_ID_ENTRANTES}`);
            return;
        }

        console.log(`✅ Lead Qualified for Reply. AI Processing...`);

        // 2. AI Processing
        // (In future pass conversation history here)
        const context = []; 
        const aiResponse = await analizarMensaje(context, messageText);

        // 3. Send Reply using the DIRECT CHAT ID
        if (aiResponse.tool_calls) {
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 AI executed Tool:", args);
            
            await sendReply(chatId, "¡Datos recibidos! Un asesor te contactará.", token);
            
            if(process.env.STATUS_ID_DESPACHO) await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
        } else {
            await sendReply(chatId, aiResponse.content, token);
            
            if(process.env.STATUS_ID_CUALIFICANDO) await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }

    } catch (error) {
        console.error("❌ Process Message Error:", error.message);
    }
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    try {
        console.log(`📤 Sending Reply to ${chatId}...`);
        await axios.post(
            `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ Message SENT Successfully!`);
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
        console.log(`➡️ Lead ${leadId} moved to Status ID ${statusId}`);
    } catch (e) {
        console.error("❌ Status Change Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Auth Verified."); } catch (e) {}
});git 