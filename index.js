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

app.get('/', (req, res) => res.send('Copacol AI Integrator (Secured) UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            // Solo procesamos Incoming
            if (msg.type === 'incoming') {
                // Logueamos pero no actuamos todavía
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
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

        // 1. OBTENER DATOS DEL LEAD (PARA VERIFICAR PIPELINE)
        // Pedimos info del lead antes de hacer NADA
        const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const leadData = leadRes.data;

        // ============================================================
        // ⛔ PORTERO DE SEGURIDAD (SECURITY GATEKEEPER)
        // ============================================================
        const targetPipeline = parseInt(process.env.PIPELINE_ID_VENTAS); // 12549896
        const currentPipeline = leadData.pipeline_id ? parseInt(leadData.pipeline_id) : 0;

        // Si el lead NO está en el Pipeline SYE, LO IGNORAMOS TOTALMENTE
        if (currentPipeline !== targetPipeline) {
            console.log(`🛑 IGNORED: Lead is in Pipeline ${currentPipeline} (Expected ${targetPipeline}). Not my jurisdiction.`);
            return; // ABORTAR MISIÓN
        }
        
        // (Opcional) Doble chequeo de estado:
        // Solo respondemos si está en "Entrada" o "Cualificando" (o las que tú quieras)
        /*
        const statusEntrantes = parseInt(process.env.STATUS_ID_ENTRANTES);
        const statusCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);
        
        if (leadData.status_id != statusEntrantes && leadData.status_id != statusCualificando) {
             console.log(`🛑 IGNORED: Lead is in a restricted status ${leadData.status_id}.`);
             return;
        }
        */

        console.log(`✅ ACCESS GRANTED: Lead is in correct Pipeline.`);

        // 2. INTELIGENCIA ARTIFICIAL
        console.log(`🧠 AI Generating response...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);
        
        let finalText = aiResponse.tool_calls ? "¡Datos recibidos! Un asesor revisará tu pedido." : aiResponse.content;
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 

        // 3. ACTUALIZAR CAMPO
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
        if (!fieldId) return console.error("❌ MISSING VAR: FIELD_ID_RESPUESTA_IA");

        const updateUrl = `https://${API_DOMAIN}/api/v4/leads/${leadId}`;
        
        await axios.patch(updateUrl, {
            custom_fields_values: [
                { field_id: fieldId, values: [{ value: finalText }] }
            ]
        }, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`📝 Field Updated.`);

        // 4. MANIOBRA DE DISPARO (RETROCESO -> AVANCE)
        const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
        const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

        // Solo hacemos el movimiento si NO queremos loops infinitos de movimiento
        // Si el lead ya está en "Cualificando", lo movemos atrás y adelante
        // Si está en "Entrada", solo lo movemos adelante
        
        if (leadData.status_id == stageCualificando) {
            console.log("🔙 Stepping back...");
            await axios.patch(updateUrl, { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });
            await sleep(2000);
        }

        console.log("🔫 Firing Salesbot...");
        await axios.patch(updateUrl, { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });

    } catch (e) {
        console.error("❌ Process Error:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});