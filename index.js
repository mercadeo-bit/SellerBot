import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios'; // ⚠️ FALTABA ESTA IMPORTACIÓN
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    try {
        console.log("📩 Webhook recibido (RAW):", JSON.stringify(req.body).substring(0, 200));

        // 1. EXTRAER DATOS (Lógica robusta para Kommo)
        let lead_id = null;
        let mensaje = null;

        // Caso A: Mensaje entrante estándar de Kommo
        if (req.body.message && req.body.message.add && req.body.message.add.length > 0) {
            const data = req.body.message.add[0];
            lead_id = data.lead_id;
            mensaje = data.text;
        } 
        // Caso B: Si configuras el JSON manualmente en Salesbot (porsi acaso)
        else if (req.body.lead_id) {
            lead_id = req.body.lead_id;
            mensaje = req.body.mensaje;
        }

        // Si no hay mensaje o es del propio bot, ignoramos para evitar bucles
        if (!mensaje || !lead_id) {
            console.log("⚠️ Webhook ignorado: No se encontró mensaje o ID de lead válido.");
            return res.status(200).send('Ignored');
        }

        console.log(`🤖 Procesando para Lead ID: ${lead_id}, Mensaje: "${mensaje}"`);

        // 2. CEREBRO (OpenAI)
        const contexto = await obtenerHistorialChat(lead_id);
        const respuesta = await analizarMensaje(contexto, mensaje);

        // 3. ACCIÓN
        if (respuesta.tool_calls) {
            console.log("🛠️ IA detectó intención de guardar datos/compra.");
            const args = JSON.parse(respuesta.tool_calls[0].function.arguments);
            const token = await getAccessToken();
            
            await actualizarCamposKommo(lead_id, args, token);
            await moverEtapa(lead_id, token);
            
            // Opcional: Confirmar al cliente
            await responderKommo(lead_id, "¡Perfecto! Ya tengo tus datos. Procesando pedido...", await getAccessToken());
        } else {
            console.log("💬 IA respondió texto (Duda/Consulta).");
            // Aquí enviamos la respuesta de texto de vuelta al chat
            // IMPORTANTE: Se necesita una función real para enviar, no solo console.log
            const token = await getAccessToken();
            await responderKommo(lead_id, respuesta.content, token);
        }

        res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Error fatal en webhook:', err);
        // Respondemos 200 para que Kommo no reintente infinitamente, aunque falló
        res.status(200).send('Error procesado'); 
    }
});

// --- SOLUCIÓN ERROR RAILWAY (Stopping Container) ---
const PORT = process.env.PORT || 3000;
// La clave es el '0.0.0.0'. Sin esto, Railway no ve tu servidor.
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));


// --- FUNCIONES AUXILIARES ---

async function actualizarCamposKommo(lead_id, args, token) {
    try {
        console.log("📝 Actualizando campos en Kommo...", args);
        // MAPEO DE TUS CAMPOS (Asegúrate que estas variables estén en Railway)
        const mapping = {
            "ms_direccion_exacta": process.env.FIELD_ID_DIRECCION,
            "ms_documento_numero": process.env.FIELD_ID_CEDULA,
            // Agrega aquí los otros mapeos si los tienes en la IA
        };

        const custom_fields_values = [];
        
        for (const [key, value] of Object.entries(args)) {
            if (mapping[key]) {
                custom_fields_values.push({
                    field_id: Number(mapping[key]),
                    values: [{ value: String(value) }]
                });
            }
        }

        if (custom_fields_values.length === 0) return;

        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`;
        await axios.patch(url, { custom_fields_values }, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        console.log("✅ Campos actualizados con éxito.");
    } catch (e) {
        console.error("❌ Error actualizando campos:", e.response?.data || e.message);
    }
}

async function moverEtapa(lead_id, token) {
    try {
        console.log("🚚 Moviendo lead de etapa...");
        const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`;
        await axios.patch(url, { 
            pipeline_id: Number(process.env.PIPELINE_ID_VENTAS), 
            status_id: Number(process.env.STATUS_ID_DESPACHO) 
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log("✅ Lead movido a despacho.");
    } catch (e) {
        console.error("❌ Error moviendo etapa:", e.response?.data || e.message);
    }
}

async function responderKommo(lead_id, texto, token) {
    try {
        // NOTA: Enviar mensajes nativos requiere la API de Chat.
        // Método Alternativo Rápido: Agregamos una NOTA al lead y si tienes configurado
        // que las notas se envíen, llegará. Si no, necesitaríamos implementar /api/v4/chat.
        // Por ahora, usaremos console.log para validar que la lógica corre.
        
        // *SI TIENES UN ENDPOINT PARA ENVIAR MENSAJES (WPP API EXTERNA), PÓNLO AQUÍ*
        // Como estamos usando la integración nativa de Kommo, enviar mensajes VÍA CÓDIGO 
        // a la conversación es complejo sin saber el chat_id. 
        
        console.log(`🗨️ [SIMULACIÓN] RESPUESTA A CLIENTE: "${texto}"`);
        
        // PISTA PARA EL USUARIO:
        // Si quieres que esto llegue al WhatsApp real, necesitamos implementar
        // la llamada a POST /api/v4/chats/.../messages. 
        // Eso requiere extraer el 'chat_id' del webhook entrante ( req.body.message.add[0].chat_id )
        
    } catch (error) {
        console.error("Error enviando respuesta:", error);
    }
}

async function obtenerHistorialChat(leadId) {
    // Retornamos vacío por seguridad para que no falle.
    return [];
}