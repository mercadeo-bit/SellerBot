import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    // 1. Responder OK rápido
    res.status(200).send('OK');

    try {
        const body = req.body;
        console.log("📨 Payload Received");

        // 2. DETECCIÓN INTELIGENTE DE DOMINIO
        // Kommo siempre nos dice su dominio real en el payload
        let baseDomain = process.env.KOMMO_SUBDOMAIN + '.kommo.com'; // Default
        
        if (body.account && body.account._links && body.account._links.self) {
            // Extraer dominio real (ej: mercadeocopacolcalicom.amocrm.com)
            const selfUrl = body.account._links.self;
            const match = selfUrl.match(/https?:\/\/([^\/]+)/);
            if (match && match[1]) {
                baseDomain = match[1];
                console.log(`🌍 Account lives on: ${baseDomain}`);
            }
        }

        // 3. PROCESAR MENSAJE
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`💬 MESSAGE DETECTED. Chat ID: ${msg.chat_id}`);
                // Pasamos el dominio correcto a la función
                await processReply(msg.entity_id, msg.chat_id, msg.text, baseDomain);
            }
        }

    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processReply(leadId, chatId, incomingText, domain) {
    try {
        const token = await getAccessToken();

        // VALIDACIÓN RÁPIDA DE CONEXIÓN
        // Verificamos que el token funcione en este dominio específico
        try {
            await axios.get(`https://${domain}/api/v4/account`, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (authErr) {
            console.error(`❌ Token rejected on ${domain}. trying kommo.com fallback...`);
            if (domain.includes('amocrm')) domain = domain.replace('amocrm', 'kommo');
        }

        console.log(`🤖 AI Thinking...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        const replyText = aiResponse.tool_calls ? "¡Datos recibidos!" : aiResponse.content;

        // RESPONDER AL DOMINIO CORRECTO
        await sendReply(chatId, replyText, token, domain);

    } catch (e) {
        console.error("❌ Logic Error:", e.message);
    }
}

async function sendReply(chatId, text, token, domain) {
    if (!text) return;

    const url = `https://${domain}/api/v4/talks/chats/${chatId}/messages`;
    console.log(`📤 SENDING TO: ${url}`);

    try {
        await axios.post(
            url,
            { text: text },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log(`✅ MESSAGE SENT SUCCESS! 🚀`);
    } catch (e) {
        console.error("❌ Send Failed.");
        console.error("👉 Status:", e.response?.status);
        console.error("👉 Reason:", JSON.stringify(e.response?.data));
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});