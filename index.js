import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import qs from 'qs'; // Needed for Kommo Webhooks
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();

// Middleware to parse Kommo's weird formatting
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.send('Copacol AI Server is Running 🚀'));

// WEBHOOK ENDPOINT
app.post('/webhook', async (req, res) => {
    // 1. Immediately respond 200 to Kommo so it doesn't retry
    res.status(200).send('OK');

    try {
        const body = req.body;
        console.log("📨 Webhook received");

        // DETECT LEAD STATUS CHANGE (Incoming Pipeline)
        if (body.leads && body.leads.status) {
            const leadData = body.leads.status[0];
            const leadId = leadData.id;
            const newStatusId = leadData.status_id;
            const pipelineId = leadData.pipeline_id;

            // Only run if it's the specific Pipeline and "Leads Entrantes" status
            if (pipelineId == process.env.PIPELINE_ID && newStatusId == process.env.STATUS_INCOMING) {
                console.log(`⚡ Processing Lead ${leadId} in Incoming Status`);
                await procesarLeadEntrante(leadId);
            }
        } 
        
        // DETECT NEW UNSORTED (New Chats often land here first)
        // If you set up the hook on "Unsorted", this handles it.
        else if (body.leads && body.leads.add) {
             const leadData = body.leads.add[0];
             // Logic can be similar, depends on your Webhook setup
             console.log(`⚡ New Lead Added: ${leadData.id}`);
             // Check status/pipeline logic here if needed
        }

    } catch (err) {
        console.error('❌ Webhook Logic Error:', err);
    }
});

async function procesarLeadEntrante(leadId) {
    const token = await getAccessToken();
    
    // 1. Get Lead Details (We need to find the chat/contact info)
    const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`;
    const leadInfo = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
    
    // Get the most recent contact to find the Chat ID
    const contactId = leadInfo.data._embedded.contacts[0]?.id;
    if(!contactId) {
        console.log("❌ No contact found for lead.");
        return;
    }

    // 2. Get Contact Info to find Chat ID (Conversation ID)
    const contactUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}`;
    const contactRes = await axios.get(contactUrl, { headers: { Authorization: `Bearer ${token}` } });
    
    // Attempt to grab the last message or custom logic
    // Usually, the "Last Message" isn't fully in the contact, we might need the Chat History
    // For this MVP, we will try to reply to the lead's associated chat.
    
    // We assume the input text is the "last message" stored in metadata or we fetch the chat.
    // Simplifying: Let's assume we reply to the Initial Inquiry.
    const messageInput = "Hola, estoy interesado."; // If possible, fetch real last msg from Chat API
    
    // 3. AI Processing
    // History context can be empty for the very first message
    const respuestaAI = await analizarMensaje([], messageInput); 

    // 4. Execution
    if (respuestaAI.tool_calls) {
        // AI wants to update fields (Closing)
        const args = JSON.parse(respuestaAI.tool_calls[0].function.arguments);
        console.log("🛠 Updating Lead Info:", args);
        await actualizarCamposKommo(leadId, args, token);
        await responderKommo(contactId, respuestaAI.content || "Datos actualizados, gracias.", token);
        
        // Final move? Depends on your flow. Maybe keep it there or move to "Ready".
    } else {
        // Normal text response
        await responderKommo(contactId, respuestaAI.content, token);
        
        // 5. MOVE TO "QUALIFYING" STAGE
        await moverEtapa(leadId, token);
    }
}

async function responderKommo(contactId, texto, token) {
    if (!texto) return;

    // To send a WhatsApp message, we typically use the Chat API
    // GET /api/v4/contacts/{id}/chats to find the Chat ID
    
    try {
        // Step A: Find the Chat ID for this contact
        const chatListUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}/chats`;
        const chatRes = await axios.get(chatListUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // This relies on the contact having an active chat (Woo/WhatsApp)
        const chatId = chatRes.data._embedded?.chats[0]?.chat_id;

        if (chatId) {
             const sendUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`;
             const payload = {
                 text: texto,
                 // attachment: ... if needed
             };
             await axios.post(sendUrl, payload, { headers: { Authorization: `Bearer ${token}` } });
             console.log(`✅ Message sent to Chat ${chatId}`);
        } else {
             console.log("⚠️ No Active Chat ID found. Cannot reply via WA.");
        }
    } catch (e) {
        console.error("❌ Failed to send message:", e.response?.data || e.message);
    }
}

async function moverEtapa(leadId, token) {
    const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
    try {
        await axios.patch(url, { 
            status_id: parseInt(process.env.STATUS_QUALIFYING),
            pipeline_id: parseInt(process.env.PIPELINE_ID) 
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`🚚 Lead ${leadId} moved to Qualifying`);
    } catch (e) {
        console.error("❌ Error moving stage:", e.response?.data);
    }
}

async function actualizarCamposKommo(leadId, args, token) {
    const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
    // You need to map "ms_nombre_completo" to the REAL ID in Kommo (e.g. 123456)
    // For now, this is a placeholder mapping logic
    /* 
    const body = {
        custom_fields_values: [
            { field_id: 123456, values: [{ value: args.ms_nombre_completo }] }
        ]
    };
    await axios.patch(url, body, ...);
    */
    console.log("Mock Update Fields: ", args);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));