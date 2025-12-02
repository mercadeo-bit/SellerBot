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

        // 1. Pedir el Lead PERO pidiendo ver si tiene metadatos
        // Ojo: A veces el chat_id está en "custom_fields" o "metadata"
        const leadUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts,catalog_elements,is_price_modified,loss_reason,only_deleted`;
        const leadRes = await axios.get(leadUrl, { headers: { Authorization: `Bearer ${token}` } });
        const leadData = leadRes.data;

        // 🚨 AQUÍ ESTÁ LA CLAVE: Vamos a imprimir el Lead completo
        console.log("📄 FULL LEAD DATA DUMP:", JSON.stringify(leadData, null, 2));

        const contactId = leadData._embedded.contacts?.[0]?.id;
        
        // Verificación de seguridad
        if (leadData.pipeline_id != process.env.PIPELINE_ID_VENTAS) {
            console.log(`🛑 Ignoring Lead ${leadId}: Wrong Pipeline (${leadData.pipeline_id})`);
            return;
        }

        if (!contactId) return console.log("❌ Lead has no contact attached. Cannot reply.");
        console.log(`👤 Contact ID: ${contactId}`);

        // ... (Saltamos la parte de OpenAI por un segundo para no gastar saldo mientras debuggeamos)
        // Solo queremos ver si podemos encontrar el chat
        
        // Intento 2: Buscar Chat en el Contacto (Ya sabemos que esto fallaba, pero lo dejamos por si acaso)
        await sendReply(contactId, "Ping de prueba (No responder)", token);

    } catch (error) {
        console.error("❌ Process Lead Error:", error.message);
    }
}

async function sendReply(contactId, text, token) {
    if (!text) return;
    try {
        console.log(`🔍 Fetching Chat info for Contact ${contactId}...`);
        
        // Petición al contacto incluyendo los chats
        const chatUrl = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}?with=chats`;
        const chatRes = await axios.get(chatUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // 🚨 IMPRIMIR TODO LO QUE DEVUELVE KOMMO (Para encontrar el ID)
        // Esto aparecerá en tus logs y nos dirá la verdad
        console.log("📄 CONTACT DATA DUMP:", JSON.stringify(chatRes.data._embedded, null, 2));

        const chats = chatRes.data._embedded?.chats;

        if (chats && chats.length > 0) {
            const chatId = chats[0].chat_id;
            console.log(`💬 Found Chat ID: ${chatId}`);

            await axios.post(
                `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`,
                { text: text },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log(`✅ Message Sent to Chat ${chatId}`);
        } else {
            console.log("⚠️ NO ACTIVE CHAT FOUND. The 'chats' array is empty or undefined.");
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