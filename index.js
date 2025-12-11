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

app.get('/', (req, res) => res.send('Copacol AI Integrator (STRICT MODE) UP 🟢'));

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

        // 1. OBTENER INFORMACIÓN DEL LEAD
        const leadRes = await axios.get(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        const leadData = leadRes.data;
        
        // ============================================================
        // ⛔ FILTRO DE SEGURIDAD ESTRICTO (MANDATORY)
        // ============================================================
        
        // Convertimos a String para asegurar comparación exacta texto-texto
        const REQUIRED_PIPELINE = String(process.env.PIPELINE_ID_VENTAS).trim(); 
        const CURRENT_PIPELINE = String(leadData.pipeline_id || 0); // Si es null/undefined se vuelve "0"

        console.log(`🛡️ SECURITY AUDIT for Lead ${leadId}:`);
        console.log(`   Expected Pipeline: [${REQUIRED_PIPELINE}]`);
        console.log(`   Actual Pipeline:   [${CURRENT_PIPELINE}]`);

        if (CURRENT_PIPELINE !== REQUIRED_PIPELINE) {
            console.log(`⛔ ACCESO DENEGADO: El lead está en pipeline ${CURRENT_PIPELINE}. Se requiere ${REQUIRED_PIPELINE}. IGNORANDO.`);
            return; // 💀 MUERTE AL PROCESO AQUÍ MISMO.
        }

        console.log(`✅ ACCESO CONCEDIDO: Pipeline coincide. Procesando...`);

        // 2. GENERACIÓN IA
        console.log(`🧠 AI Generating response...`);
        const context = []; 
        const aiResponse = await analizarMensaje(context, incomingText);

        // 3. EJECUCIÓN (ACCIÓN O CHAT)
        if (aiResponse.tool_calls) {
            // MODO ACCIÓN
            console.log("🛠️ AI Action: Finalizar Compra");
            
            const toolArgs = JSON.parse(aiResponse.tool_calls[0].function.arguments);
            await handleOrderCreation(leadId, toolArgs, token);
            
            await updateAiResponseField(leadId, "¡Excelente! Tus datos están completos. Generando orden de despacho... 🚚", token);

            // Mover a MasterShop
            if (ID_PIPELINE_MASTERSHOP !== 0 && ID_STATUS_INICIAL_MASTERSHOP !== 0) {
                console.log(`🚚 MOVING TO MASTERSHOP...`);
                try {
                    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
                        pipeline_id: parseInt(ID_PIPELINE_MASTERSHOP),
                        status_id: parseInt(ID_STATUS_INICIAL_MASTERSHOP)
                    }, { headers: { Authorization: `Bearer ${token}` } });
                    return; 
                } catch (moveError) {
                    console.error("⚠️ Error moving lead:", moveError.message);
                }
            }

        } else {
            // MODO CHAT
            let finalText = aiResponse.content || "...";
            finalText = finalText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
            if (finalText.length > 250) finalText = finalText.substring(0, 248) + "..";
            
            await updateAiResponseField(leadId, finalText, token);

            // GATILLO DE SALESBOT (Retroceso -> Avance)
            const stageEntrada = parseInt(process.env.STATUS_ID_ENTRANTES);
            const stageCualificando = parseInt(process.env.STATUS_ID_CUALIFICANDO);

            if (leadData.status_id == stageCualificando) {
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

    } catch (e) {
        console.error("❌ Process Error:", e.message);
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
        
        await axios.post(`https://${API_DOMAIN}/api/v4/leads/${leadId}/link`, [
            {
                to_entity_id: PRODUCT_ID,
                to_entity_type: "catalog_elements",
                metadata: { quantity: quantity, catalog_id: 77598 }
            }
        ], { headers: { Authorization: `Bearer ${token}` } });
        console.log("✅ Order Data Linked.");

    } catch (error) {
        console.error("⚠️ Order Save Error:", error.response?.data || error.message);
    }
}

async function updateAiResponseField(leadId, text, token) {
    const fieldId = parseInt(process.env.FIELD_ID_RESPUESTA_IA);
    if (!fieldId) { console.error("❌ MISSING VAR: FIELD_ID_RESPUESTA_IA"); return; }

    await axios.patch(`https://${API_DOMAIN}/api/v4/leads/${leadId}`, {
        custom_fields_values: [
            { field_id: fieldId, values: [{ value: text }] }
        ]
    }, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`📝 Field Updated.`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot ready on port ${PORT}`);
    try { await getAccessToken(); console.log("✅ Verified."); } catch (e) {}
});