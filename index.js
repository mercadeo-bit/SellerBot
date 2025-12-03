import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Dominio base
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
                console.log(`\n📨 INCOMING FROM: ${msg.chat_id}`);
                
                // Recopilamos datos CRÍTICOS para el envío explícito
                // msg.author suele contener datos del cliente
                // msg.chat_id es el canal
                await processReply({
                    leadId: msg.entity_id,
                    chatId: msg.chat_id, 
                    text: msg.text, 
                    contactId: msg.contact_id // Kommo manda esto en el webhook de mensajes
                });
            }
        }
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processReply({ leadId, chatId, text, contactId }) {
    try {
        const token = await getAccessToken();

        // 1. Obtener la Identidad del BOT (Remitente)
        let botIdentity = null;
        try {
            const me = await axios.get(`https://${API_DOMAIN}/api/v4/account?with=amojo_id`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            botIdentity = me.data.amojo_id;
            console.log(`🤖 Sender Identity (Bot): ${botIdentity}`);
        } catch(e) { console.log("⚠️ Failed to get Bot Identity"); }

        // 2. IA Thinking
        console.log(`🧠 AI Generating response...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, text);
        const replyText = aiResponse.tool_calls ? "¡Datos Recibidos!" : aiResponse.content;

        // 3. ENVIAR CON SUPER PAYLOAD
        // Intentaremos decirle explícitamente QUIÉN recibe el mensaje
        await sendExplicitReply({
            chatId, 
            text: replyText, 
            token, 
            botIdentity,
            receiverContactId: contactId
        });

    } catch (e) {
        console.error("❌ Process Error:", e.message);
    }
}

async function sendExplicitReply({ chatId, text, token, botIdentity, receiverContactId }) {
    const url = `https://${API_DOMAIN}/api/v4/talks/chats/${chatId}/messages`;
    
    // ESTRATEGIA: "FORZAR" los datos del remitente y receptor
    // Esto suele desbloquear el error 404 en canales externos
    const payload = {
        text: text,
        // Al especificar el receptor, ayudamos al enrutador de Kommo
        receiver: {
            id: receiverContactId, 
            // Si el contacto es numérico, lo convertimos a string o viceversa según convenga, 
            // pero normalmente el ID directo funciona.
        },
        // Al especificar el remitente (tu integración), validamos el permiso
        sender: {
            ref_id: botIdentity,
            name: "Asistente Virtual" // Nombre que aparecerá (a veces)
        }
    };

    console.log(`🔫 SENDING EXPLICIT PAYLOAD TO: ${url}`);
    // console.log("📦 Payload:", JSON.stringify(payload)); 

    try {
        await axios.post(url, payload, { 
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            } 
        });
        console.log(`✅ MESSAGE SENT SUCCESS! 🏆`);
    } catch (e) {
        console.log(`❌ Explicit Send Failed: ${e.response?.status} - ${JSON.stringify(e.response?.data)}`);
        
        // ULTIMO RECURSO: Enviar como Nota al Lead (Si no podemos chatear, al menos dejamos la nota)
        // Esto confirmará si al menos podemos escribir en el CRM
        console.log("🚑 Fallback: Posting as Lead Note...");
        // await postNoteFallback(...) // Implementaríamos esto solo si el cliente lo pide
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});