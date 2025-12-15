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

// Mastershop Pipelines
const ID_PIPELINE_MASTERSHOP = 12549896; 
const ID_STATUS_INICIAL_MASTERSHOP = 96929184;

// Lead Fields Map (User Provided)
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

app.get('/', (req, res) => res.send('Copacol AI: Mastershop Full Flow UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                // Fire and forget (don't block web request)
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

    // 1. OBTENER INFORMACIÓN DEL LEAD
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { 
        headers: { Authorization: `Bearer ${token}` } 
    });
    const leadData = leadRes.data;
    
    // 🛡️ SECURITY AUDIT (Strict Pipeline Check)
    const REQUIRED_PIPELINE = String(process.env.PIPELINE_ID_VENTAS).trim(); 
    const CURRENT_PIPELINE = String(leadData.pipeline_id || 0);

    if (CURRENT_PIPELINE !== REQUIRED_PIPELINE) {
        console.log(`⛔ SKIP: Lead in Pipeline ${CURRENT_PIPELINE} (Expected: ${REQUIRED_PIPELINE})`);
        return; 
    }
    console.log(`✅ ACCESS GRANTED. Processing logic...`);

    // 2. RECUPERAR CONTEXTO & DEDUPLICAR
    console.log(`📜 Fetching conversation history...`);
    const history = await getConversationHistory(leadId, token);

    // DEDUPLICATION: If the last memory is the same as the current msg, remove it so AI doesn't see double.
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg.role === 'user' && incomingText && lastMsg.content.trim() === incomingText.trim()) {
            console.log("   ✂️ Deduplicating: Ignoring redundant history message.");
            history.pop();
        }
    }

    // 3. GENERACIÓN IA
    const aiResponse = await analizarMensaje(history, incomingText);

    // 4. EJECUCIÓN (Action vs Chat)
    if (aiResponse.tool_calls) {
        // ===========================================
        // 🛠️ MODO ACCIÓN: FINALIZAR COMPRA
        // ===========================================
        console.log("🛠️ AI Action: Finalizar Compra");
        
        const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        await handleOrderCreation(leadId, toolArgs, token);
        
        // Confirmation Message
        const confirmationText = `¡Listo ${toolArgs.nombre}! 🎉\n\nTu orden ha sido registrada exitosamente. Vamos a procesar tu envío a la dirección: ${toolArgs.direccion}, ${toolArgs.ciudad}.\n\nSi tienes preguntas adicionales, un asesor humano revisará este chat pronto. ¡Gracias por confiar en Copacol!`;
        
        await updateAiResponseField(leadId, confirmationText, token);

        // Send the confirmation immediately
        await triggerSalesbotLoop(leadId, leadData.status_id, token);

        // MOVE TO MASTERSHOP
        if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP PIPELINE...`);
            try {
                // Wait 4 seconds to let the message send before moving
                await sleep(4000); 
                await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                    pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                    status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                }, { headers: { Authorization: `Bearer ${token}` } });
                console.log("✅ Lead Moved Successfully.");
            } catch (e) { console.error("⚠️ Move Error:", e.message); }
        }

    } else {
        // ===========================================
        // 💬 MODO CHAT: CONVERSACIÓN NORMAL
        // ===========================================
        let finalText = aiResponse.content || "...";
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        
        await updateAiResponseField(leadId, finalText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);
    }
}

// Helper to Trigger Kommo Salesbot (Status toggle)
async function triggerSalesbotLoop(leadId, currentStatus, token) {
    const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
    const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

    if (currentStatus == stageCualificando) {
        console.log("🔙 Stepping back...");
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
            { status_id: stageEntrada }, 
            { headers: { Authorization: `Bearer ${token}` } }
        );
        await sleep(1500); 
    }

    console.log("🔫 Firing Salesbot (Forward Move)...");
    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
        { status_id: stageCualificando }, 
        { headers: { Authorization: `Bearer ${token}` } }
    );
}

// ---------------------------------------------------------
// 🧠 HELPER: CONTEXT RETRIEVAL (WIDE NET VERSION)
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

            // User Msgs
            if (ev.type === 'incoming_chat_message' || ev.type === 'chat_message' || ev.type === 'incoming_sms') {
                role = 'user';
                content = ev.value_after && ev.value_after[0] ? ev.value_after[0].note.text : ev.data?.text;
            } 
            // Bot Msgs
            else if (ev.type === 'outgoing_chat_message' || ev.type === 'outgoing_sms') {
                role = 'assistant';
                content = ev.value_after && ev.value_after[0] ? ev.value_after[0].note.text : ev.data?.text;
            }

            // Cleanup
            if (!content && typeof ev.value === 'string') content = ev.value;

            if (role && content && typeof content === 'string') {
                 content = content.replace(/<[^>]*>?/gm, '').trim();
                 // Filter System/Noise
                 if (content.length > 1 && !content.includes("updated the stage")) {
                     messages.push({ role, content });
                 }
            }
        }
        console.log(`   ✅ History Loaded: ${messages.length} messages.`);
        return messages;
    } catch (err) {
        console.error("⚠️ History fetch warning:", err.message);
        return []; 
    }
}

// ---------------------------------------------------------
// 🛠️ DATA SAVER
// ---------------------------------------------------------

async function updateAiResponseField(leadId, text, token) {
    try {
        const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA); // Make sure this is 2100125 in ENV
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

        // Save fields
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            price: totalValue, 
            custom_fields_values: customFields
        }, { headers: { Authorization: `Bearer ${token}` } });
        
        // Link Catalog Item
        try {
            await axios.post(`https://${API_DOMAIN}/api/v4/leads/${leadId}/link`, [
                {
                    to_entity_id: PRODUCT_ID,
                    to_entity_type: "catalog_elements",
                    metadata: { quantity: quantity, catalog_id: 77598 }
                }
            ], { headers: { Authorization: `Bearer ${token}` } });
        } catch(e) { /* ignore catalog link error */ }
        
        console.log("✅ Order Data & Catalog Linked.");

    } catch (error) {
        console.error("⚠️ Order Save Error:", error.response?.data || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Copacol Server READY on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ OAuth Token Verified."); } catch (e) { }
});