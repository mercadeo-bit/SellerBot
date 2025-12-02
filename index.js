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

// Health Check Route
app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

// WEBHOOK ROUTE
app.post('/webhook', async (req, res) => {
    // 🚨 DEBUG LOG: This will print ANY data Kommo sends. 
    // If you see this in logs, the connection works!
    console.log("📨 Webhook Payload Received:", JSON.stringify(req.body, null, 2));

    // Respond fast to Kommo
    res.status(200).send('OK'); 

    try {
        const body = req.body;

        // CASE 1: LEAD STATUS CHANGE (When dragging a lead)
        if (body.leads && body.leads.status) {
            const lead = body.leads.status[0];
            
            // Log for debugging IDs
            console.log(`🔎 Checking Status Change: Lead=${lead.id}, Status=${lead.status_id}, Pipeline=${lead.pipeline_id}`);
            
            // Check logic
            if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS && 
                lead.status_id == process.env.STATUS_ID_ENTRANTES) {
                
                console.log(`🔔 Target Status Hit! Processing Lead ${lead.id}...`);
                await processLead(lead.id);
            } else {
                console.log(`Running Check: Current ${lead.status_id} !== Target ${process.env.STATUS_ID_ENTRANTES}`);
            }
        }
        
        // CASE 2: NEW LEAD CREATED (When a client writes for the first time)
        if (body.leads && body.leads.add) {
            const lead = body.leads.add[0];
            console.log(`🔎 Checking New Lead: Lead=${lead.id}, Pipeline=${lead.pipeline_id}`);

             if (lead.pipeline_id == process.env.PIPELINE_ID_VENTAS) {
                 console.log(`🔔 New Lead Detected! Processing Lead ${lead.id}...`);
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

        // 1. Get contact info associated with the Lead
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        const contactId = leadRes.data._embedded.contacts?.[0]?.id;
        if (!contactId) return console.log("❌ Lead has no contact attached. Cannot reply.");

        console.log(`👤 Processing Contact ID: ${contactId}`);

        // 2. Mock Context (TODO: Fetch real chat history here later)
        const context = []; 
        const incomingMessage = "Hola, me interesa más información."; 

        // 3. Ask OpenAI
        const aiResponse = await analizarMensaje(context, incomingMessage);

        // 4. Execute AI Action
        if (aiResponse.tool_calls) {
            // Case: AI wants to run a function (save data)
            const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            console.log("💾 AI executed Tool - Saving Data:", args);
            
            await sendReply(contactId, "¡Perfecto! He guardado tus datos para el despacho. Un asesor validará tu pedido pronto.", token);
            
            // Move to Despacho
            if(process.env.STATUS_ID_DESPACHO) {
                await changeStatus(leadId, process.env.STATUS_ID_DESPACHO, token);
            }
        } else {
            // Case: AI just replies with text
            console.log("🤖 AI Reply:", aiResponse.content);
            await sendReply(contactId, aiResponse.content, token);
            
            // Move to Cualificando to avoid loops
            await changeStatus(leadId, process.env.STATUS_ID_CUALIFICANDO, token);
        }
    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
    }
}

async function sendReply(contactId, text, token) {
    if (!text) return;
    try {
        // Step A: Find the active Chat ID for this contact
        const chatUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}/chats`;
        const chatRes = await axios.get(chatUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // Kommo usually returns an array of chats. We take the most recent.
        const chatId = chatRes.data._embedded?.chats?.[0]?.chat_id;

        if (chatId) {
            await axios.post(
                `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
                { text: text },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log(`✅ Message Sent to Chat ${chatId}`);
        } else {
            console.log("⚠️ Contact has no active Chat ID (Needs at least one incoming message).");
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
        console.log(`➡️ Lead ${leadId} moved to Status ID ${statusId}`);
    } catch (e) {
        console.error("❌ Status Change Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;

// 🔥 SERVER START (Corrected for Railway Networking)
// '0.0.0.0' allows external access
app.listen(PORT, '0.0.0.0', async () => {
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