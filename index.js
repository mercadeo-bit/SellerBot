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
const PRODUCT_ID = 1755995; 
const PRODUCT_PRICE = 319900; 

// CONFIGURACIÓN MASTERSHOP
const ID_PIPELINE_MASTERSHOP = 12631352; 
const ID_STATUS_INICIAL_MASTERSHOP = 97525680;

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

app.get('/', (req, res) => res.send('Copacol AI Integrator (MEMORY FIX v2) UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                // Don't wait for processing to send 200 OK to Kommo
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
    
    // ============================================================
    // ⛔ FILTRO DE SEGURIDAD ESTRICTO
    // ============================================================
    const REQUIRED_PIPELINE = String(process.env.PIPELINE_ID_VENTAS).trim(); 
    const CURRENT_PIPELINE = String(leadData.pipeline_id || 0);

    if (CURRENT_PIPELINE !== REQUIRED_PIPELINE) {
        console.log(`⛔ SKIP: Lead in Pipeline ${CURRENT_PIPELINE} (Expected: ${REQUIRED_PIPELINE})`);
        return; 
    }

    console.log(`✅ ACCESS GRANTED. Processing logic...`);

    // 2. RECUPERAR CONTEXTO (MEMORY FIX 🧠)
    console.log(`📜 Fetching conversation history...`);
    const history = await getConversationHistory(leadId, token);
    console.log(`   Found ${history.length} previous messages.`);

    // 3. GENERACIÓN IA
    const aiResponse = await analizarMensaje(history, incomingText);

    // 4. EJECUCIÓN (ACCIÓN O CHAT)
    if (aiResponse.tool_calls) {
        // --- MODO ACCIÓN: FINALIZAR COMPRA ---
        console.log("🛠️ AI Action: Finalizar Compra");
        
        const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        await handleOrderCreation(leadId, toolArgs, token);
        
        await updateAiResponseField(leadId, "¡Excelente! Tus datos están completos. Generando orden de despacho... 🚚", token);

        if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP...`);
            await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
            }, { headers: { Authorization: `Bearer ${token}` } });
        }

    } else {
        // --- MODO CHAT: RESPONDER ---
        let finalText = aiResponse.content || "...";
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        if (finalText.length > 250) finalText = finalText.substring(0, 248) + "..";
        
        await updateAiResponseField(leadId, finalText, token);

        // GATILLO DE SALESBOT (Retroceso -> Avance)
        const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
        const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

        if (leadData.status_id == stageCualificando) {
            console.log("🔙 Stepping back (Trigger Loop)...");
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
}

// ---------------------------------------------------------
// 🧠 HELPER: CONTEXT RETRIEVAL FROM KOMMO EVENTS
// ---------------------------------------------------------
async function getConversationHistory(leadId, token) {
    try {
        // FIXED URL: 
        // 1. Changed 'chat_message' -> 'incoming_chat_message'
        // 2. Used array syntax 'filter[type][]' to prevent 400 Bad Request errors on strict parsing
        const url = `https://${API_DOMAIN}/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=10&filter[type][]=incoming_chat_message&filter[type][]=outgoing_chat_message`;
        
        const res = await axios.get(url, { 
            headers: { Authorization: `Bearer ${token}` } 
        });

        if (!res.data || !res.data._embedded || !res.data._embedded.events) {
            return [];
        }

        const events = res.data._embedded.events;
        const messages = [];

        // Events come Newest -> Oldest. We reverse them to feed OpenAI chronologically.
        for (const ev of events.reverse()) {
            let role = 'user';
            let content = '';

            // Extract content safely
            if (ev.type === 'incoming_chat_message') {
                role = 'user';
                // Try to find text in different standard Kommo paths
                content = ev.value_after && ev.value_after[0] ? ev.value_after[0].note.text : ev.data?.text;
            } 
            else if (ev.type === 'outgoing_chat_message') {
                role = 'assistant';
                content = ev.value_after && ev.value_after[0] ? ev.value_after[0].note.text : ev.data?.text;
            }

            // Fallback for simple values
            if (!content && typeof ev.value === 'string') content = ev.value;

            // Clean & Add
            if (content && typeof content === 'string') {
                 // Remove HTML tags often left by Kommo (e.g. <p>)
                 content = content.replace(/<[^>]*>?/gm, '').trim();
                 
                 // Skip system status messages if any sneak in
                 if (content.length > 0 && !content.includes("updated the stage")) {
                     messages.push({ role, content });
                 }
            }
        }
        
        return messages;

    } catch (err) {
        // Detailed error logging to see exactly why it fails if it happens again
        console.error("⚠️ Failed to fetch history:", err.response?.data ? JSON.stringify(err.response.data) : err.message);
        return []; 
    }
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
        
        // Try linking the catalog item
        try {
            await axios.post(`https://${API_DOMAIN}/api/v4/leads/${leadId}/link`, [
                {
                    to_entity_id: PRODUCT_ID,
                    to_entity_type: "catalog_elements",
                    metadata: { quantity: quantity, catalog_id: 77598 }
                }
            ], { headers: { Authorization: `Bearer ${token}` } });
        } catch(linkErr) {
            console.log("⚠️ Catalog Link warning (ignorable):", linkErr.response?.data || linkErr.message);
        }
        
        console.log("✅ Order Data Linked.");

    } catch (error) {
        console.error("⚠️ Order Save Error:", error.response?.data || error.message);
    }
}

async function updateAiResponseField(leadId, text, token) {
    const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
    if (!fieldId) { console.error("❌ MISSING VAR: FIELD_ID_RESPUESTA_IA"); return; }

    try {
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            custom_fields_values: [
                { field_id: fieldId, values: [{ value: text }] }
            ]
        }, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`📝 Field Updated: "${text.substring(0, 20)}..."`);
    } catch(e) {
        console.error("❌ Failed to update Response Field:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Copacol Server READY on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ OAuth Token Verified."); } catch (e) { console.log("⚠️ Auth check failed on boot (normal if first run)"); }
});