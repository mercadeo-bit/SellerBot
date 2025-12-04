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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => res.send('Copacol AI Integrator (Infinity Chat) UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        // INTERCEPTAMOS EL MENSAJE ENTRANTE
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            // Solo responder a mensajes del cliente (incoming)
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
        const context = []; // En el futuro implementaremos historial aquí
        const aiResponse = await analizarMensaje(context, incomingText);
        
        let finalText = aiResponse.tool_calls ? "¡Datos recibidos! Un asesor revisará tu pedido." : aiResponse.content;
        
        // Limpieza de caracteres que rompen JSON
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 

        console.log(`📝 Updating Field...`);

        // 2. ACTUALIZAR EL CAMPO (CARGAR LA BALA)
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
        if (!fieldId) return console.error("❌ MISSING VAR: FIELD_ID_RESPUESTA_IA");

        const updateUrl = `https://${API_DOMAIN}/api/v4/leads/${leadId}`;
        
        try {
            await axios.patch(updateUrl, {
                custom_fields_values: [
                    { field_id: fieldId, values: [{ value: finalText }] }
                ]
            }, { headers: { Authorization: `Bearer ${token}` } });
            console.log(`✅ FIELD UPDATED.`);

            // 3. LA MANIOBRA DE DISPARO (RETROCESO -> AVANCE)
            // Esto obliga al Salesbot a detectar una "entrada" a la etapa cada vez
            
            const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);    // Etapa Anterior
            const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO); // Etapa Objetivo

            // Paso A: Mover Atrás (Recargar)
            console.log("🔙 Stepping back to re-trigger...");
            await axios.patch(updateUrl, { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });

            // Paso B: Esperar (Para que Kommo procese el cambio)
            await sleep(2000);

            // Paso C: Mover Adelante (Disparar)
            console.log("🔫 Firing (Moving to Target Stage)...");
            await axios.patch(updateUrl, { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });
            
            console.log(`🚀 Salesbot TRIGGERED for continuous chat.`);

        } catch (updateErr) {
            console.error("❌ Move Failed:", updateErr.response?.data || updateErr.message);
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