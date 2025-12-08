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

// === IDS DE MASTERSHOP (CONFIGURACIÓN) ===
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

app.get('/', (req, res) => res.send('Copacol AI Integrator (Secured) UP 🟢'));

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const body = req.body;
        
        if (body.message && body.message.add) {
            const msg = body.message.add[0];
            if (msg.type === 'incoming') {
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

        // 1. VERIFICAR PIPELINE ACTUAL
        const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const leadData = leadRes.data;
        
        const targetPipeline = parseInt(process.env.PIPELINE_ID_VENTAS);
        const currentPipeline = leadData.pipeline_id ? parseInt(leadData.pipeline_id) : 0;

        if (currentPipeline !== targetPipeline) {
            console.log(`🛑 IGNORED: Lead is in Pipeline ${currentPipeline}.`);
            return;
        }

        console.log(`✅ ACCESS GRANTED. Processing...`);

        // 2. AI GENERATION
        console.log(`🧠 AI Generating response...`);
        // Currently context is empty (Amnessic mode to prevent large context errors)
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);

        // 3. DECISIÓN: ¿COMANDO DE ACCIÓN O CHAT?
        if (aiResponse.tool_calls) {
            // ==========================================
            // 🚀 ACTION MODE (DATA COLLECTED -> MOVE)
            // ==========================================
            console.log("🛠️ AI Triggered Action: Finalizar Compra");
            
            // A) Save Fields & Link Product
            const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            await handleOrderCreation(leadId, toolArgs, token);
            
            // B) Confirm to User
            const confirmationText = "¡Excelente! Tus datos están completos. Generando orden de despacho... 🚚";
            await updateAiResponseField(leadId, confirmationText, token);

            // C) MOVE TO MASTERSHOP PIPELINE
            if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
                console.log(`🚚 MOVING LEAD TO MASTERSHOP...`);
                
                try {
                    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                        pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                        status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                    }, { headers: { Authorization: `Bearer ${token}` } });
                    
                    console.log("✅ TRANSFER COMPLETE. Lead left the chatbot.");
                    return; // ⛔ STOP HERE.
                } catch (moveError) {
                    console.error("⚠️ Error moving lead:", moveError.response?.data || moveError.message);
                }
            }

        } else {
            // ==========================================
            // 💬 CHAT MODE (QUALIFYING)
            // ==========================================
            let finalText = aiResponse.content || "...";
            finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
            
            // 🛑 SAFETY SCISSORS: CRITICAL FIX FOR 400 ERROR
            // Kommo only accepts 255 chars in text fields. We cut at 250 to be safe.
            if (finalText.length > 250) {
                console.log(`⚠️ Truncating text from ${finalText.length} to 250 chars to prevent Kommo crash.`);
                finalText = finalText.substring(0, 248) + "..";
            }
            
            await updateAiResponseField(leadId, finalText, token);

            // 4. TRIGGER SALESBOT (Only in Qualifying Mode)
            const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
            const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

            if (leadData.status_id == stageCualificando) {
                await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
                    { status_id: stageEntrada }, 
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                await sleep(2000); // Wait for Kommo to process the move
            }

            console.log("🔫 Firing Salesbot...");
            await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, 
                { status_id: stageCualificando }, 
                { headers: { Authorization: `Bearer ${token}` } }
            );
        }

    } catch (e) {
        console.error("❌ Process Error:", e.message);
        // Tip: If error is 400, it's usually the field content being invalid/too long
        if (e.response && e.response.status === 400) {
            console.error("Data sent:", e.response.config.data);
        }
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
        console.log("✅ Lead Fields Saved.");

        await axios.post(`https://${API_DOMAIN}/api/v4/leads/${leadId}/link`, [
            {
                to_entity_id: PRODUCT_ID,
                to_entity_type: "catalog_elements",
                metadata: { quantity: quantity, catalog_id: 12053 }
            }
        ], { headers: { Authorization: `Bearer ${token}` } });
        console.log("✅ Product Linked.");

    } catch (error) {
        console.error("⚠️ Partial Save Error:", error.response?.data || error.message);
    }
}

async function updateAiResponseField(leadId, text, token) {
    const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
    if (!fieldId) return;

    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
        custom_fields_values: [
            { field_id: fieldId, values: [{ value: text }] }
        ]
    }, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`📝 AI Response Updated.`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});