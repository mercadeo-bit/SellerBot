import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Forzamos amocrm.com (confirmado por tus logs)
const API_DOMAIN = process.env.KOMMO_SUBDOMAIN + '.amocrm.com';

app.get('/', (req, res) => res.send('Copacol AI Integrator is UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        // INTERCEPTAMOS EL MENSAJE
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG: "${msg.text}"`);
                console.log(`ℹ️ UUID: ${msg.chat_id} | Num ID: ${msg.talk_id || 'N/A'}`);
                
                // Disparamos la lógica
                await processReply(msg.entity_id, msg.chat_id, msg.text, msg.talk_id);
            }
        }
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processReply(leadId, chatUuid, incomingText, talkIdInt) {
    try {
        const token = await getAccessToken();

        // 1. OBTENER LA IDENTIDAD DEL BOT (AMOJO_ID)
        // Esto es crucial para firmar el mensaje
        let botAmojoId = null;
        try {
            console.log("🕵️ Fetching Bot Identity (Amojo ID)...");
            const accRes = await axios.get(`https://${API_DOMAIN}/api/v4/account?with=amojo_id`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            botAmojoId = accRes.data.amojo_id;
            console.log(`🤖 Bot Identity Found: ${botAmojoId}`);
        } catch (e) {
            console.log("⚠️ Could not fetch Amojo ID. Sending anonymous.");
        }

        // 2. IA THINKING
        console.log(`🧠 AI Generating response...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        const textToSend = aiResponse.tool_calls ? "¡Datos recibidos!" : aiResponse.content;

        // ============================================================
        // FASE DE DISPARO MÚLTIPLE (QUEMANDO TODAS LAS OPCIONES)
        // ============================================================

        // OPCIÓN 1: Enviar al UUID con firma de autor
        const sent1 = await trySend({
            targetId: chatUuid,
            text: textToSend,
            token,
            label: "UUID + Identity",
            senderId: botAmojoId
        });

        if (sent1) return; // Si funcionó, terminamos.

        // OPCIÓN 2: Enviar al ID Numérico (Si existe)
        if (talkIdInt) {
            const sent2 = await trySend({
                targetId: talkIdInt, // Usamos el número corto (ej: 6703)
                text: textToSend,
                token,
                label: "NUMERIC ID + Identity",
                senderId: botAmojoId
            });
            if (sent2) return;
        }

        // OPCIÓN 3: Payload Complejo (Estructura legacy)
        // A veces se requiere una estructura diferente
        console.log("⚠️ All simple attempts failed. Trying Complex Payload...");
        /* Aquí podríamos meter un fallback más agresivo si todo falla */

    } catch (e) {
        console.error("❌ Process Error:", e.message);
    }
}

async function trySend({ targetId, text, token, label, senderId }) {
    const url = `https://${API_DOMAIN}/api/v4/talks/chats/${targetId}/messages`;
    console.log(`🔫 [${label}] Trying POST to: .../chats/${targetId}/messages`);
    
    // Construimos el body. Si tenemos ID de sender, lo agregamos.
    const payload = { text: text };
    
    // NOTA: En V4 standard el sender suele inferirse, pero en algunos endpoints
    // se pasa como header o propiedad extra. Probamos standard primero.
    
    try {
        await axios.post(url, payload, { 
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-M-Id': senderId // A veces se usa este header no documentado para identidad
            } 
        });
        console.log(`✅ [${label}] SUCCESS! MESSAGE SENT! 🏆`);
        return true;
    } catch (e) {
        console.log(`❌ [${label}] Failed (${e.response?.status}): ${JSON.stringify(e.response?.data)}`);
        return false;
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});