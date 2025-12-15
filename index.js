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

app.get('/', (req, res) => res.send('Copacol AI: DEEP DEBUG VERSION 🟢'));

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

    // 2. RECUPERAR CONTEXTO (DEEP DEBUG MODE)
    const history = await getConversationHistory(leadId, token);

    // DEDUPLICAR
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        const txtA = String(lastMsg.content || "").trim().toLowerCase();
        const txtB = String(incomingText || "").trim().toLowerCase();
        if (lastMsg.role === 'user' && txtA === txtB) {
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
        
        const confirmationText = `¡Listo ${toolArgs.nombre}! 🎉\n\nTu orden ha sido registrada exitosamente para enviar a ${toolArgs.ciudad}. Vamos a proceder con el despacho. ¡Gracias por elegir a Copacol! 🙏🏽`;
        await updateAiResponseField(leadId, confirmationText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);

        if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP PIPELINE...`);
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
// 🧠 HELPER: X-RAY UNIVERSAL PARSER (THE FIX)
// ---------------------------------------------------------
async function getConversationHistory(leadId, token) {
    try {
        const url = `https://${API_DOMAIN}/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=50`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!res.data || !res.data._embedded || !res.data._embedded.events) return [];

        const events = res.data._embedded.events;
        const messages = [];

        // Reverse to get Chronological order
        for (const ev of events.reverse()) {
            let role = '';
            let content = '';

            // --- ROLE DETECTION ---
            if (['incoming_chat_message', 'incoming_sms'].includes(ev.type)) role = 'user';
            else if (['outgoing_chat_message', 'outgoing_sms'].includes(ev.type)) role = 'assistant';
            
            // Skip irrelevant types
            if (!role) continue;

            // --- CONTENT X-RAY SEARCH (Checks all known Kommo paths) ---
            
            // 1. Standard Note (Most common)
            if (ev.value_after && ev.value_after[0] && ev.value_after[0].note && ev.value_after[0].note.text) {
                content = ev.value_after[0].note.text;
            }
            // 2. Message Object (WhatsApp Native often hides here)
            else if (ev.value_after && ev.value_after[0] && ev.value_after[0].message && ev.value_after[0].message.text) {
                content = ev.value_after[0].message.text;
            }
            // 3. Data Text (System events)
            else if (ev.data && ev.data.text) {
                content = ev.data.text;
            }
            // 4. Value String (SMS/Simple)
            else if (typeof ev.value === 'string') {
                content = ev.value;
            }

            // --- CLEANUP ---
            if (content && typeof content === 'string') {
                content = content.replace(/<[^>]*>?/gm, '').trim();
                // Filter noise
                if (content.length > 1 && !content.includes("updated the stage") && !content.includes("bot started")) {
                    messages.push({ role, content });
                }
            }
        }
        
        console.log(`   📜 History Check: Found ${messages.length} valid messages.`);
        
        // 🔴 DEBUG X-RAY: If 0 messages found, show me WHY by printing the raw object of the last event
        if (messages.length === 0 && events.length > 0) {
            console.log("   ⚠️ ZERO MESSAGES FOUND. Dumping raw last event for inspection:");
            // Find a chat event to dump
            const chatEvent = events.find(e => e.type.includes('chat') || e.type.includes('sms'));
            if (chatEvent) {
                console.log(JSON.stringify(chatEvent, null, 2));
            } else {
                console.log("   (No chat events found in the raw list either)");
            }
        }

        return messages;

    } catch (err) {
        console.error("⚠️ History Fetch Error:", err.message);
        return []; 
    }
}

// ---------------------------------------------------------
// 🛠️ DATA SAVER (UPDATED)
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
    // ... (This function remains the same as before, no changes needed here) ...
    // But included for completeness of the file if you copy/paste:
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