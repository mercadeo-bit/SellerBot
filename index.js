import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const API_DOMAIN = process.env.KOMMO_SUBDOMAIN + '.amocrm.com';

// Lead Fields Map
const FIELDS = {
    NOMBRE: 2099831, APELLIDO: 2099833, CORREO: 2099835, TELEFONO: 2099837,
    DEPARTAMENTO: 2099839, CIUDAD: 2099841, DIRECCION: 2099843,
    INFO_ADICIONAL: 2099845, FORMA_PAGO: 2099849, VALOR_TOTAL: 2099863, CEDULA: 2099635
};

const ID_PIPELINE_MASTERSHOP = 12549896; 
const ID_STATUS_INICIAL_MASTERSHOP = 96929184;
const PRODUCT_ID = 1755995; 
const PRODUCT_PRICE = 319900; 
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 📂 LOCAL MEMORY SETUP
const HISTORY_FILE = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'chat_history.json') 
    : './chat_history.json';

// Initialize History File
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({}));
}

app.get('/', (req, res) => res.send('Copacol AI: LOCAL MEMORY SYSTEM UP 🧠'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    try {
        const body = req.body;
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
                console.log(`\n📨 INCOMING MSG from Lead ${msg.entity_id}`);
                // Only process text messages
                if(msg.text) {
                    processSmartFieldReply(msg.entity_id, msg.text).catch(err => 
                        console.error("❌ Async Process Error:", err.message)
                    );
                }
            }
        }
    } catch (err) { console.error('❌ Webhook Error:', err.message); }
});

async function processSmartFieldReply(leadId, incomingText) {
    const token = await getAccessToken();

    // 1. INFO LEAD
    const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { headers: { Authorization: `Bearer ${token}` } });
    const leadData = leadRes.data;
    
    // SECURITY AUDIT
    const REQUIRED_PIPELINE = String(process.env.PIPELINE_ID_VENTAS).trim(); 
    if (String(leadData.pipeline_id) !== REQUIRED_PIPELINE) {
        console.log(`⛔ SKIP: Pipeline ${leadData.pipeline_id}`);
        return; 
    }

    // 2. 🧠 LOCAL MEMORY MANAGEMENT
    // Read current history
    const allHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    let chatHistory = allHistory[leadId] || [];

    // Append USER message (The one that just arrived)
    // Avoid appending if it's identical to the last user message (Dup check)
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== incomingText) {
        chatHistory.push({ role: 'user', content: incomingText });
    }

    // Limit memory to last 10 messages to keep prompt clean
    if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);

    console.log(`🧠 Memory Loaded: ${chatHistory.length} messages.`);

    // 3. AI GENERATION
    const aiResponse = await analizarMensaje(chatHistory, incomingText); // Pass full history

    // 4. SAVE BOT RESPONSE TO MEMORY
    if (aiResponse.content) {
        chatHistory.push({ role: 'assistant', content: aiResponse.content });
        // Save back to file
        allHistory[leadId] = chatHistory;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(allHistory, null, 2));
    }

    // 5. EXECUTION
    if (aiResponse.tool_calls) {
        console.log("🛠️ AI Action: Finalizar Compra");
        const args = JSON.parse(aiResponse.tool_calls[0].function.arguments);
        await handleOrderCreation(leadId, args, token);
        
        const confirmationText = `¡Listo ${args.nombre}! 🎉\n\nTu orden ha sido registrada. Vamos a procesar tu envío a ${args.ciudad}. ¡Gracias por confiar en Copacol! 🙏🏽`;
        await updateAiResponseField(leadId, confirmationText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);

        // Move to Mastershop
        if (ID_PIPELINE_MASTERSHOP !== 0) {
            console.log(`🚚 MOVING TO MASTERSHOP...`);
            try {
                await sleep(3000); 
                await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                    pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                    status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                }, { headers: { Authorization: `Bearer ${token}` } });
            } catch (e) { console.error("⚠️ Move Error:", e.message); }
        }
    } else {
        // CHAT
        let finalText = aiResponse.content || "...";
        finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
        await updateAiResponseField(leadId, finalText, token);
        await triggerSalesbotLoop(leadId, leadData.status_id, token);
    }
}

// ---------------------------------------------------------
// 🛠️ UTILS
// ---------------------------------------------------------
async function updateAiResponseField(leadId, text, token) {
    try {
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
            custom_fields_values: [{ field_id: parseInt(process.env.FIELD_ID_RESPUESTA_IA), values: [{ value: text }] }]
        }, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`📝 Field Updated.`);
    } catch(e) { console.error("❌ Field Update Failed:", e.message); }
}

async function triggerSalesbotLoop(leadId, currentStatus, token) {
    const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
    const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);
    if (currentStatus == stageCualificando) {
        console.log("🔙 Loop: Back...");
        await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { status_id: stageEntrada }, { headers: { Authorization: `Bearer ${token}` } });
        await sleep(1000); 
    }
    console.log("🔫 Loop: Forward...");
    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { status_id: stageCualificando }, { headers: { Authorization: `Bearer ${token}` } });
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
    try { await getAccessToken(); console.log("✅ Token Verified."); } catch (e) { }
});