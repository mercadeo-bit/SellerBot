import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Dominio detectado (Legacy)
const API_DOMAIN = process.env.KOMMO_SUBDOMAIN + '.amocrm.com';

// TIEMPO DE ESPERA PARA QUE KOMMO PROCESE EL CAMPO
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => res.send('Copacol AI Integrator (Stage Trigger) UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        // INTERCEPTAMOS EL MENSAJE
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}: "${msg.text}"`);
                await processSmartFieldReply(msg.entity_id, msg.text);
            }
        }
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processSmartFieldReply(leadId, incomingText) {
    try {
        const token = await getAccessToken();

        // 1. Pensar respuesta IA
        console.log(`🧠 AI Generating response...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        
        // Limpieza de texto
        let finalText = aiResponse.tool_calls ? "¡Datos recibidos! Un asesor revisará tu pedido." : aiResponse.content;
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 

        console.log(`📝 Updating Field & Moving Stage...`);

        // 2. ACTUALIZAR CAMPO
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
        if (!fieldId) return console.error("❌ MISSING VAR: FIELD_ID_RESPUESTA_IA");

        const updateUrl = `https://${API_DOMAIN}/api/v4/leads/${leadId}`;
        
        try {
            // Paso A: Guardar la respuesta en el campo
            await axios.patch(updateUrl, {
                custom_fields_values: [
                    { field_id: fieldId, values: [{ value: finalText }] }
                ]
            }, { headers: { Authorization: `Bearer ${token}` } });
            
            console.log(`✅ FIELD UPDATED.`);

            // ESPERAR 1 SEGUNDO (Vital para que Kommo no se sature antes de mover)
            await sleep(1000);

            // Paso B: MOVER DE ETAPA (El Gatillo)
            // Movemos a "Cualificando" (Status ID 96928848 según tus logs)
            const targetStatus = parseInt(process.env.STATUS_ID_CUALIFICANDO);
            
            await axios.patch(updateUrl, {
                status_id: targetStatus
            }, { headers: { Authorization: `Bearer ${token}` } });

            console.log(`➡️ MOVED TO STAGE ${targetStatus}. Salesbot should fire now!`);

        } catch (updateErr) {
            console.error("❌ Update/Move Failed:", updateErr.response?.data || updateErr.message);
        }

    } catch (e) {
        console.error("❌ Process Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});