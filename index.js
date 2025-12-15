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

// ----------------------------------------------------
// ⚙️ CONFIGURATION
// ----------------------------------------------------
const PRODUCT_ID = 1755995; 
const PRODUCT_PRICE = 319900; 
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

app.get('/', (req, res) => res.send('Copacol AI: NOTES + EVENTS FIX 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const body = req.body;
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                processSmartFieldReply(msg.entity_id, msg.text).catch(err => 
                    console.error("❌ Async Process Error:", err.message)
                );
            }
        }
    } catch (err) {
        console.error('❌ Webhook Error:', err.message);
    }
});

async function processSmartFieldReply(leadId, incomingText) {
    const token = await getAccessToken();

    // 1. INFO LEAD
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { 
        headers: { Authorization: `Bearer ${token}` } 
    });
    const leadData = leadRes.data;
    
    // 🛡️ SECURITY AUDIT
    const REQUIRED_PIPELINE = String(process.env.PIPELINE_ID_VENTAS).trim(); 
    const CURRENT_PIPELINE = String(leadData.pipeline_id || 0);

    if (CURRENT_PIPELINE !== REQUIRED_PIPELINE) {
        console.log(`⛔ SKIP: Pipeline ${CURRENT_PIPELINE} (Expected: ${REQUIRED_PIPELINE})`);
        return; 
    }
    console.log(`✅ ACCESS GRANTED.`);

    // 2. RECUPERAR CONTEXTO (NOW CHECKING NOTES TOO!)
    const history = await getConversationHistory(leadId, token);

    // DEDUPLICAR
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        const txtA = String(lastMsg.content || "").trim().toLowerCase();
        const txtB = String(incomingText || "").trim().toLowerCase();
        // Loose comparison to catch duplicates
        if (lastMsg.role === 'user' && (txtA.includes(txtB) || txtB.includes(txtA))) {
            console.log("   ✂️ Deduplicating: Removed last history message.");
            history.pop();
        }
    }

    // 3. GENERACIÓN IA
    const aiResponse = await analizarMensaje(history, incomingText);

    // 4. EJECUCIÓN
    if (aiResponse.tool_calls) {
        // MODO ACCIÓN
        console.log("🛠️ AI Action: Finalizar Compra");
        const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        await handleOrderCreation(leadId, toolArgs, token);
        
        const confirmationText = `¡Listo ${toolArgs.nombre}! 🎉\n\nTu orden ha sido registrada exitosamente. Vamos a procesar tu envío a ${toolArgs.ciudad}. ¡Gracias por confiar en Copacol! 🙏🏽`;
        
        await updateAiResponseField(leadId, confirmationText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);

        if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP...`);
            try {
                await sleep(3000); 
                await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                    pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                    status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                }, { headers: { Authorization: `Bearer ${token}` } });
                console.log("✅ Lead Moved.");
            } catch (e) { console.error("⚠️ Move Error:", e.message); }
        }

    } else {
        // MODO CHAT
        let finalText = aiResponse.content || "...";
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        await updateAiResponseField(leadId, finalText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);
    }
}

async function triggerSalesbotLoop(leadId, currentStatus, token) {
    const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
    const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

    if (currentStatus == stageCualificando) {
        console.log("🔙 Loop: Back...");
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
            { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });
        await sleep(1000); 
    }
    console.log("🔫 Loop: Forward...");
    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
        { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });
}

// ---------------------------------------------------------
// 🧠 HELPER: HYBRID HISTORY FETCH (NOTES + EVENTS)
// ---------------------------------------------------------
async function getConversationHistory(leadId, token) {
    let allMessages = [];

    // STRATEGY: Try Notes Endpoint FIRST (More reliable for custom integrations)
    try {
        const notesUrl = `https://${API_DOMAIN}/api/v4/leads/${leadId}/notes?limit=50`;
        const notesRes = await axios.get(notesUrl, { headers: { Authorization: `Bearer ${token}` } });
        
        if (notesRes.data?._embedded?.notes) {
            const rawNotes = notesRes.data._embedded.notes.reverse(); // Oldest first
            
            // 🔎 DEBUG: Peek at what types we found
            if(rawNotes.length > 0) {
               console.log(`   🔎 RAW TYPES FOUND: ${rawNotes.map(n => n.note_type).slice(0, 5).join(', ')}`);
            }

            for (const n of rawNotes) {
                let content = '';
                // 1. Text is often in params.text for Service Messages
                if (n.params && n.params.text) content = n.params.text;
                // 2. Or just standard text
                else if (n.text) content = n.text;
                
                // Identify Role based on Type or Content clues
                // QR Widgets often use 'common' or 'service_message'
                if (content) {
                    // HEURISTIC: If text contains "Incoming" or "Outgoing", or rely on note_type
                    let role = 'user'; // default assumption
                    
                    if (n.note_type === 'outgoing_chat_message' || n.note_type === 'call_out') role = 'assistant';
                    
                    // Specific check for your "Respuesta IA" logic if stored as a note
                    // If content starts with "¡Hola" it's likely the bot.
                    if (content.startsWith("¡Hola! Mi nombre es Sofía")) role = 'assistant';

                    // Clean
                    content = content.replace(/<[^>]*>?/gm, '').trim();
                    if (content.length > 2 && !content.includes("bot started")) {
                         allMessages.push({ role, content });
                    }
                }
            }
        }
    } catch (e) { /* ignore note errors */ }

    // If Notes yielded nothing, try EVENTS (The old way)
    if (allMessages.length === 0) {
        try {
            const eventsUrl = `https://${API_DOMAIN}/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=50`;
            const evRes = await axios.get(eventsUrl, { headers: { Authorization: `Bearer ${token}` } });
            
            if (evRes.data?._embedded?.events) {
                const events = evRes.data._embedded.events.reverse();
                for (const ev of events) {
                    let role = '';
                    let content = '';

                    if (['incoming_chat_message', 'incoming_sms'].includes(ev.type)) role = 'user';
                    else if (['outgoing_chat_message', 'outgoing_sms'].includes(ev.type)) role = 'assistant';

                    if (ev.value_after && ev.value_after[0]?.note?.text) content = ev.value_after[0].note.text;
                    else if (ev.data?.text) content = ev.data.text;

                    if (role && content) {
                         content = content.replace(/<[^>]*>?/gm, '').trim();
                         if (content.length > 1) allMessages.push({ role, content });
                    }
                }
            }
        } catch (e) { /* ignore event errors */ }
    }

    console.log(`   ✅ Hybrid History: Loaded ${allMessages.length} messages.`);
    return allMessages;
}


// ---------------------------------------------------------
// 🛠️ DATA SAVER
// ---------------------------------------------------------
async function updateAiResponseField(leadId, text, token) {
    try {
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA); 
        if (!fieldId) return;

        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            custom_fields_values: [
                { field_id: fieldId, values: [{ value: text }] }
            ]
        }, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`📝 Field Updated.`);
    } catch(e) { console.error("❌ Field Update Failed:", e.message); }
}

async function handleOrderCreation(leadId, args, token) {
    try {
        console.log("📝 Saving Order Data...");
        const quantity = args.cantidad_productos || 1;
        const totalValue = quantity * PRODUCT_PRICE;

        const customFields = [
            { field_id: FIELDS.NOMBRE, values: [{ value: args.nombre }] },
            { field_id: FIELDS.APELLIDO, values: [{ value: args.apellido }] },
            { field_id: FIELDS.CEDULA, values: [{ value: args.cedula }] },
            { field_id: FIELDS.TELEFONO, values: [{ value: args.telefono }] },
            { field_id: FIELDS.CORREO, values: [{ value: args.email || "noaplica@copacol.com" }] },
            { field_id: FIELDS.DEPARTAMENTO, values: [{ value: args.departamento }] },
            { field_id: FIELDS.CIUDAD, values: [{ value: args.ciudad }] },
            { field_id: FIELDS.DIRECCION, values: [{ value: args.direccion }] },
            { field_id: FIELDS.INFO_ADICIONAL, values: [{ value: args.info_adicional || "-" }] },
            { field_id: FIELDS.FORMA_PAGO, values: [{ value: "Pago Contra Entrega (Con recaudo)" }] },
            { field_id: FIELDS.VALOR_TOTAL, values: [{ value: totalValue }] }
        ];

        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            price: totalValue, 
            custom_fields_values: customFields
        }, { headers: { Authorization: `Bearer ${token}` } });
        
        try {
            await axios.post(`https://${API_DOMAIN}/api/v4/leads/${leadId}/link`, [
                {
                    to_entity_id: PRODUCT_ID,
                    to_entity_type: "catalog_elements",
                    metadata: { quantity: quantity, catalog_id: 77598 }
                }
            ], { headers: { Authorization: `Bearer ${token}` } });
        } catch(e) {}
        console.log("✅ Order Data Linked.");
    } catch (error) { console.error("⚠️ Order Save Error:", error.message); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Copacol Server READY on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ OAuth Token Verified."); } catch (e) { }
});