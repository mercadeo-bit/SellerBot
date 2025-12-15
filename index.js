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
const ID_PIPELINE_MASTERSHOP = 12631352; 
const ID_STATUS_INICIAL_MASTERSHOP = 97525680;

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

app.get('/', (req, res) => res.send('Copacol AI: CONTACT HISTORY FIX 🟢'));

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

    // 1. OBTENER INFORMACIÓN DEL LEAD (INCLUYENDO CONTACTOS)
    // Agregamos ?with=contacts para obtener el ID de la persona
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}?with=contacts`, { 
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
    console.log(`✅ ACCESS GRANTED. Finding Contact...`);

    // 2. DETECTAR ID DEL CONTACTO
    let contactId = null;
    if (leadData._embedded && leadData._embedded.contacts && leadData._embedded.contacts.length > 0) {
        contactId = leadData._embedded.contacts[0].id;
        console.log(`👤 Connected Contact ID: ${contactId}`);
    } else {
        console.log("⚠️ No Contact linked to Lead. History might be empty.");
    }

    // 3. RECUPERAR CONTEXTO (DEL CONTACTO, NO DEL LEAD)
    console.log(`📜 Fetching conversation history...`);
    // Pass the contactId to the history fetcher
    const history = await getConversationHistory(leadId, contactId, token);

    // DEDUPLICAR
    if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        const txtA = String(lastMsg.content || "").trim().toLowerCase();
        const txtB = String(incomingText || "").trim().toLowerCase();
        
        // Comparación simple para evitar bucles inmediatos
        if (lastMsg.role === 'user' && (txtA.includes(txtB) || txtB.includes(txtA))) {
            console.log("   ✂️ Deduplicating: Removed last history message.");
            history.pop();
        }
    }

    // 4. GENERACIÓN IA
    const aiResponse = await analizarMensaje(history, incomingText);

    // 5. EJECUCIÓN
    if (aiResponse.tool_calls) {
        // --- MODO ACCIÓN ---
        console.log("🛠️ AI Action: Finalizar Compra");
        const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        await handleOrderCreation(leadId, toolArgs, token);
        
        const confirmationText = `¡Listo ${toolArgs.nombre}! 🎉\n\nTu orden ha sido registrada exitosamente. Vamos a procesar tu envío a la dirección: ${toolArgs.direccion}, ${toolArgs.ciudad}.\n\nSi tienes preguntas adicionales, un asesor humano revisará este chat pronto. ¡Gracias por confiar en Copacol! 🙏🏽`;
        
        await updateAiResponseField(leadId, confirmationText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);

        // MOVE TO MASTERSHOP
        if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP...`);
            try {
                await sleep(4000); 
                await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                    pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                    status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                }, { headers: { Authorization: `Bearer ${token}` } });
                console.log("✅ Lead Moved Successfully.");
            } catch (e) { console.error("⚠️ Move Error:", e.message); }
        }

    } else {
        // --- MODO CHAT ---
        let finalText = aiResponse.content || "...";
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        
        await updateAiResponseField(leadId, finalText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);
    }
}

// ---------------------------------------------------------
// 🧠 HELPER: CONTACT-BASED HISTORY RETRIEVAL
// ---------------------------------------------------------
async function getConversationHistory(leadId, contactId, token) {
    let allMessages = [];

    // Si tenemos un contacto, buscamos su historial (Aquí está el Chat de WhatsApp)
    if (contactId) {
        try {
            // Buscamos eventos en la entidad 'contact' en vez de 'lead'
            const eventsUrl = `https://${API_DOMAIN}/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=50`;
            const evRes = await axios.get(eventsUrl, { headers: { Authorization: `Bearer ${token}` } });
            
            if (evRes.data?._embedded?.events) {
                const events = evRes.data._embedded.events.reverse();
                for (const ev of events) {
                    let role = '';
                    let content = '';

                    // Detect Roles
                    if (['incoming_chat_message', 'incoming_sms', 'chat_message'].includes(ev.type)) role = 'user';
                    else if (['outgoing_chat_message', 'outgoing_sms'].includes(ev.type)) role = 'assistant';

                    // Extract Text (Universal methods)
                    if (ev.value_after && ev.value_after[0]?.note?.text) content = ev.value_after[0].note.text;
                    else if (ev.value_after && ev.value_after[0]?.message?.text) content = ev.value_after[0].message.text; // WhatsApp often here
                    else if (ev.data?.text) content = ev.data.text;
                    
                    if (role && content) {
                         content = content.replace(/<[^>]*>?/gm, '').trim();
                         // Evitar mensajes del sistema
                         if (content.length > 1 && !content.includes("updated the stage")) {
                             allMessages.push({ role, content });
                         }
                    }
                }
            }
        } catch (e) { console.error("⚠️ Contact History Error:", e.message); }
    }

    // FALLBACK: Si no hay historial en contacto (raro), miramos el Lead
    if (allMessages.length === 0) {
        try {
            console.log("   ⚠️ Empty Contact history. Checking Lead history as fallback...");
            const leadEventsUrl = `https://${API_DOMAIN}/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=50`;
            const res = await axios.get(leadEventsUrl, { headers: { Authorization: `Bearer ${token}` } });

            if (res.data?._embedded?.events) {
                const events = res.data._embedded.events.reverse();
                for (const ev of events) {
                    let role = ''; 
                    let content = '';
                    
                    if (['incoming_chat_message'].includes(ev.type)) role = 'user';
                    else if (['outgoing_chat_message'].includes(ev.type)) role = 'assistant';

                    if (ev.value_after && ev.value_after[0]?.note?.text) content = ev.value_after[0].note.text;
                    
                    if (role && content) allMessages.push({ role, content: content.replace(/<[^>]*>?/gm, '') });
                }
            }
        } catch(e) {}
    }

    console.log(`   ✅ History Loaded: ${allMessages.length} messages found (via Contact/Lead).`);
    return allMessages;
}

// ---------------------------------------------------------
// 🛠️ UTILS
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

async function triggerSalesbotLoop(leadId, currentStatus, token) {
    const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
    const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

    if (currentStatus == stageCualificando) {
        console.log("🔙 Stepping back...");
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
            { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });
        await sleep(1500); 
    }
    console.log("🔫 Firing Salesbot...");
    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
        { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });
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