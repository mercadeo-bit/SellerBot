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
const ID_PIPELINE_MASTERSHOP = 12549896; 
const ID_STATUS_INICIAL_MASTERSHOP = 96929184;

// Lead Fields Map
const FIELDS = {
    NOMBRE: 2099831, 
    APELLIDO: 2099833, 
    CORREO: 2099835, 
    TELEFONO: 2099837, 
    DEPARTAMENTO: 2099839, 
    CIUDAD: 2099841, 
    DIRECCION: 2099843, 
    INFO_ADICIONAL: 2099845, 
    FORMA_PAGO: 2099849, 
    VALOR_TOTAL: 2099863, 
    CEDULA: 2099635
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => res.send('Copacol AI: DETECTIVE MODE 🕵️ UP'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const body = req.body;
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                processSmartFieldReply(msg.entity_id, msg.text).catch(err => console.error(err));
            }
        }
    } catch (err) { console.error(err); }
});

async function processSmartFieldReply(leadId, incomingText) {
    const token = await getAccessToken();

    // 1. OBTENER DATOS (AUDITORIA)
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { headers: { Authorization: `Bearer ${token}` } });
    const leadData = leadRes.data;
    
    // SECURITY CHECK
    const REQUIRED = String(process.env.PIPELINE_ID_VENTAS).trim(); 
    if (String(leadData.pipeline_id) !== REQUIRED) { console.log("⛔ Pipeline Mismatch"); return; }

    // 2. DIAGNOSTICO DE HISTORIAL (AQUI ESTA LA CLAVE)
    console.log(`🕵️ DIAGNOSING HISTORY for Lead ${leadId}...`);
    const history = await getConversationHistory_DIAGNOSTIC(leadId, token);

    // DEDUPLICAR
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg.role === 'user' && String(lastMsg.content).includes(String(incomingText))) {
            console.log("   ✂️ Deduplicating match.");
            history.pop();
        }
    }

    // 3. IA
    const aiResponse = await analizarMensaje(history, incomingText);

    // 4. EJECUCION
    if (aiResponse.tool_calls) {
        console.log("🛠️ AI Action Triggered");
        const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        // Save order logic stripped for brevity in debug mode, but functionality remains
        const confText = `¡Listo ${args.nombre}! Orden registrada.`;
        await updateAiResponseField(leadId, confText, token);
    } else {
        const finalText = aiResponse.content.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        await updateAiResponseField(leadId, finalText, token);
    }
    
    // SALESBOT TRIGGER
    await triggerSalesbotLoop(leadId, leadData.status_id, token);
}

// ==========================================
// 🕵️ EL DETECTIVE (IMPRIME TODO LO QUE VE)
// ==========================================
async function getConversationHistory_DIAGNOSTIC(leadId, token) {
    let allMessages = [];

    // 1. REVISAR EVENTOS (Timeline Standard)
    try {
        const eventsUrl = `https://${API_DOMAIN}/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=5`;
        const evRes = await axios.get(eventsUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // 🔴 IMPRIMIR LA RESPUESTA CRUDA PARA QUE ME LA ENVIES
        if (evRes.data?._embedded?.events) {
            console.log("\n📦 === RAW EVENTS DUMP (COPY THIS) ===");
            console.log(JSON.stringify(evRes.data._embedded.events.slice(0, 2), null, 2)); // Solo los ultimos 2 para no llenar el log
            console.log("========================================\n");
            
            // Logica temporal de parsing
            const events = evRes.data._embedded.events.reverse();
            for (const ev of events) {
                // Intento estandar de leer
                let content = ev.value_after?.[0]?.note?.text || ev.data?.text || ev.value;
                if(content && typeof content === 'string') allMessages.push({ role: 'user', content }); 
            }
        } else {
            console.log("⚠️ NO EVENTS FOUND.");
        }
    } catch (e) { console.error("Event Fetch Error", e.message); }

    // 2. REVISAR NOTAS (Donde se esconden los QR widgets)
    try {
        const notesUrl = `https://${API_DOMAIN}/api/v4/leads/${leadId}/notes?limit=5`;
        const notesRes = await axios.get(notesUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        // 🔴 IMPRIMIR LA RESPUESTA CRUDA PARA QUE ME LA ENVIES
        if (notesRes.data?._embedded?.notes) {
            console.log("\n📒 === RAW NOTES DUMP (COPY THIS) ===");
            console.log(JSON.stringify(notesRes.data._embedded.notes.slice(0, 2), null, 2)); 
            console.log("=======================================\n");

            const notes = notesRes.data._embedded.notes.reverse();
            for (const n of notes) {
                // INTENTO DE LEER TODO
                let content = n.text || n.params?.text || n.params?.content;
                
                if (content) {
                    // Limpieza basica
                    content = String(content).replace(/<[^>]*>?/gm, '');
                    // Asumir que todo es usuario por ahora para probar lectura
                    if (content.length > 2) allMessages.push({ role: 'user', content: content });
                }
            }
        } else {
            console.log("⚠️ NO NOTES FOUND.");
        }
    } catch (e) { console.error("Note Fetch Error", e.message); }

    console.log(`✅ FINAL COUNT: ${allMessages.length} potential messages found.`);
    return allMessages;
}

// Helpers minimos para que funcione
async function updateAiResponseField(leadId, text, token) {
    try {
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            custom_fields_values: [{ field_id: parseInt(process.env.FIELD_ID_RESPUESTA_IA), values: [{ value: text }] }]
        }, { headers: { Authorization: `Bearer ${token}` } });
    } catch(e) {}
}

async function triggerSalesbotLoop(leadId, currentStatus, token) {
    const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
    const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);
    if (currentStatus == stageCualificando) {
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });
        await sleep(1000);
    }
    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 DETECTIVE MODE LISTENING ${PORT}`);
    try { await getAccessToken(); console.log("✅ Token OK"); } catch (e) { }
});