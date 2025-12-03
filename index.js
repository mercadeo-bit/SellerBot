import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.send('DIAGNOSTIC MODE 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    const body = req.body;

    // Solo nos interesa el mensaje entrante para la prueba
    if (body.message && body.message.add && body.message.add[0].type === 'incoming') {
        const msg = body.message.add[0];
        console.log(`\n🕵️ STARTING DIAGNOSTIC FOR CHAT: ${msg.chat_id}`);
        await runDiagnostics(msg.chat_id);
    }
});

async function runDiagnostics(chatId) {
    try {
        const token = await getAccessToken();
        
        // Determinar dominio
        const domain = "mercadeocopacolcalicom.amocrm.com"; // Forzado al que sabemos que es real

        console.log("---------------------------------------------------");
        console.log("TEST 1: CHECKING ACCOUNT & SCOPES");
        // 1. Ver detalles de la cuenta (nos dirá si el token es válido)
        try {
            const accRes = await axios.get(`https://${domain}/api/v4/account`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log("✅ ACCOUNT ACCESS: OK");
            console.log(`ℹ️ Account Name: ${accRes.data.name}`);
            console.log(`ℹ️ Current Subdomain: ${accRes.data.subdomain}`);
            // (Nota: Kommo V4 no muestra scopes explícitos aquí, pero el éxito confirma acceso básico)
        } catch (e) {
            console.log("❌ ACCOUNT ACCESS FAILED:", e.message);
            console.log(JSON.stringify(e.response?.data, null, 2));
            return; // Si esto falla, nada más funcionará
        }

        console.log("---------------------------------------------------");
        console.log("TEST 2: PEEK AT CHAT DETAILS (GET)");
        // 2. Intentar LEER el chat (GET en lugar de POST)
        // Esto verifica si tenemos permiso de lectura sobre Chats
        try {
            const chatRes = await axios.get(`https://${domain}/api/v4/talks/chats/${chatId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log("✅ READ CHAT PERMISSION: OK");
            console.log("ℹ️ Chat Type:", chatRes.data.channel_type);
        } catch (e) {
            console.log("❌ READ CHAT PERMISSION: FAILED");
            console.log("👉 Status:", e.response?.status);
            console.log("👉 Detail:", JSON.stringify(e.response?.data));
            
            // Si falla lectura, intentamos leer TODOS los chats (para ver si Talks está activo)
            console.log("   -> Trying to list ANY chat...");
            try {
                await axios.get(`https://${domain}/api/v4/talks`, { headers: { Authorization: `Bearer ${token}` } });
                console.log("   ✅ 'Talks' endpoint is ACCESSIBLE (Scope exists). The specific Chat ID is likely hidden/private.");
            } catch(e2) {
                console.log("   ❌ 'Talks' endpoint is DEAD (404/403). THE INTEGRATION LACKS 'CHATS' SCOPE.");
            }
        }

        console.log("---------------------------------------------------");
    } catch (err) {
        console.error("DIAGNOSTIC ERROR:", err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 DIAGNOSTIC BOT READY on ${PORT}`);
    await getAccessToken(); 
});