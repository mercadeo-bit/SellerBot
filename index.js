import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const API_DOMAIN = process.env.KOMMO_SUBDOMAIN + '.amocrm.com';

// Lead Fields Map
const FIELDS = {
    NOMBRE: 2099831, APELLIDO: 2099833, CORREO: 2099835, TELEFONO: 2099837,
    DEPARTAMENTO: 2099839, CIUDAD: 2099841, DIRECCION: 2099843,
    INFO_ADICIONAL: 2099845, FORMA_PAGO: 2099849, VALOR_TOTAL: 2099863, CEDULA: 2099635
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => res.send('Copacol AI: CONTACT DETECTIVE 🕵️‍♀️'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const body = req.body;
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                processDetective(msg.entity_id, msg.text).catch(err => console.error(err));
            }
        }
    } catch (err) { console.error('❌ Webhook Error:', err.message); }
});

async function processDetective(leadId, incomingText) {
    const token = await getAccessToken();

    // 1. GET LEAD & CONTACT ID
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}?with=contacts`, { 
        headers: { Authorization: `Bearer ${token}` } 
    });
    const leadData = leadRes.data;
    
    // DETECT CONTACT ID
    let contactId = null;
    if (leadData._embedded?.contacts?.length > 0) {
        contactId = leadData._embedded.contacts[0].id;
        console.log(`👤 FOUND CONTACT ID: ${contactId}`);
    } else {
        console.log("⚠️ NO CONTACT FOUND. Messages cannot be retrieved.");
        return;
    }

    // 2. DUMP CONTACT EVENTS (RAW)
    console.log(`\n🔍 SCANNING CONTACT EVENTS (ID: ${contactId})...`);
    try {
        const url = `https://${API_DOMAIN}/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=5`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        if (res.data?._embedded?.events) {
            console.log("📦 === CONTACT EVENTS DUMP ===");
            console.log(JSON.stringify(res.data._embedded.events.slice(0, 3), null, 2));
            console.log("============================\n");
        } else {
            console.log("❌ NO CONTACT EVENTS FOUND.");
        }
    } catch(e) { console.error("Event error", e.message); }

    // 3. DUMP CONTACT NOTES (RAW)
    console.log(`\n🔍 SCANNING CONTACT NOTES (ID: ${contactId})...`);
    try {
        const url = `https://${API_DOMAIN}/api/v4/contacts/${contactId}/notes?limit=5`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        
        if (res.data?._embedded?.notes) {
            console.log("📒 === CONTACT NOTES DUMP ===");
            console.log(JSON.stringify(res.data._embedded.notes.slice(0, 3), null, 2));
            console.log("===========================\n");
        } else {
            console.log("❌ NO CONTACT NOTES FOUND.");
        }
    } catch(e) { console.error("Note error", e.message); }

    // KEEP BOT ALIVE (Standard Reply Logic)
    // We execute the standard logic just so the bot answers, but the logs above are what matters.
    const history = []; // Force empty for detective test
    const aiResponse = await analizarMensaje(history, incomingText);
    let finalText = aiResponse.content || "...";
    finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
    await updateAiResponseField(leadId, finalText, token);
}

// Minimal Utils
async function updateAiResponseField(leadId, text, token) {
    try {
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            custom_fields_values: [{ field_id: fieldId, values: [{ value: text }] }]
        }, { headers: { Authorization: `Bearer ${token}` } });
    } catch(e) {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 CONTACT DETECTIVE READY ${PORT}`);
    try { await getAccessToken(); console.log("✅ Token Verified."); } catch (e) { }
});