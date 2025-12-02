import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Forzamos el dominio correcto con /api/v4 explícito
const getBaseUrl = (subdomain) => `https://${subdomain}.kommo.com/api/v4`;

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
                console.log(`💬 MESSAGE DETECTED. Chat ID: ${msg.chat_id}`);
                await processReply(msg.entity_id, msg.chat_id, msg.text);
            }
        }
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
});

async function processReply(leadId, chatId, incomingText) {
    try {
        const token = await getAccessToken();

        // 🔍 PRUEBA DE CONEXIÓN AL DOMINIO (Diagnóstico)
        console.log("🩺 Testing Connection...");
        try {
            await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/account`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log("✅ Connection Test Passed: Token and Domain are valid.");
        } catch (testErr) {
            console.error("❌ Connection Test Failed. Access Token or Domain is WRONG.", testErr.message);
            // Si falla esto, no intentamos responder porque fallará igual.
            return; 
        }

        // Consultar IA
        console.log(`🤖 AI Thinking...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        const replyText = aiResponse.tool_calls ? "¡Datos recibidos!" : aiResponse.content;

        // Intentar responder
        await sendReply(chatId, replyText, token);

    } catch (e) {
        console.error("❌ Process Reply Error:", e.message);
    }
}

async function sendReply(chatId, text, token) {
    if (!text) return;
    
    // CONSTRUCCIÓN EXPLÍCITA DE LA URL
    // Nota: Forzamos .kommo.com y /api/v4
    const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/chats/${chatId}/messages`;
    
    console.log(`📤 SENDING TO URL: ${url}`); // <--- MIRA ESTO EN EL LOG

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
        
        // REINTENTO CON AMOCRM.COM SI FALLA
        if (e.response && e.response.status === 404) {
            console.log("🔄 Retrying with .amocrm.com domain...");
            const fallbackUrl = `https://${process.env.KOMMO_SUBDOMAIN}.amocrm.com/api/v4/talks/chats/${chatId}/messages`;
            try {
                await axios.post(
                    fallbackUrl,
                    { text: text },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                console.log(`✅ RETRY SUCCESS!`);
            } catch (err2) {
                console.error("❌ Retry failed too.");
            }
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});