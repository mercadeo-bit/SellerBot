import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Forzamos amocrm.com que es donde vimos que vive tu cuenta
const API_DOMAIN = process.env.KOMMO_SUBDOMAIN + '.amocrm.com';

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        console.log("📨 Payload Received");

        // MENSAJE ENTRANTE
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`💬 WEBOOK CHAT ID: ${msg.chat_id}`);
                await processSmartReply(msg.entity_id, msg.chat_id, msg.text);
            }
        }
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processSmartReply(leadId, incomingChatId, incomingText) {
    try {
        const token = await getAccessToken();

        // 1. CONFIRMAR CHAT ID REAL USANDO "TALKS"
        // Consultamos todas las conversaciones abiertas para ver cuál coincide
        console.log(`🔎 Validating Chat ID via /talks...`);
        const talksUrl = `https://${API_DOMAIN}/api/v4/talks`;
        const talksRes = await axios.get(talksUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        const activeTalks = talksRes.data._embedded?.talks || [];
        let verifiedChatId = null;

        // Buscamos el match
        const matchingTalk = activeTalks.find(t => t.chat_id === incomingChatId);

        if (matchingTalk) {
            console.log(`✅ MATCH FOUND! Verified Chat ID: ${matchingTalk.chat_id}`);
            verifiedChatId = matchingTalk.chat_id;
        } else {
            console.log(`⚠️ Match not found in list. Using Webhook ID blindly: ${incomingChatId}`);
            verifiedChatId = incomingChatId;
        }

        console.log(`🤖 AI Thinking...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        const textToSend = aiResponse.tool_calls ? "¡Recibido!" : aiResponse.content;

        // 2. ENVIAR MENSAJE
        const sendUrl = `https://${API_DOMAIN}/api/v4/talks/chats/${verifiedChatId}/messages`;
        console.log(`📤 POSTing to: ${sendUrl}`);
        
        await axios.post(
            sendUrl,
            { text: textToSend },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log(`✅ SUCCESS! Message sent to ${verifiedChatId}`);

    } catch (e) {
        console.error("❌ PROCESS FAILED:");
        if (e.response) {
            console.error(`   Status: ${e.response.status}`);
            console.error(`   Data: ${JSON.stringify(e.response.data)}`);
            
            // Intento desesperado: Si 404, probamos con el endpoint Legacy de Amojo
            // Solo se ejecuta si lo anterior falló
            if (e.response.status === 404) {
                 console.log("🚑 EMERGENCY: Trying Legacy Endpoint /v2/origin/custom...");
                 // (Implementación futura si esto falla)
            }
        } else {
            console.error(`   Error: ${e.message}`);
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});