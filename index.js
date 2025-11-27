import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { getAccessToken } from './src/kommoAuth.js';
import { analizarMensaje } from './src/openaiService.js';
dotenv.config();


const app = express();
app.use(express.json());


app.post('/webhook', async (req, res) => {
try {
const { lead_id, mensaje } = req.body;
const contexto = await obtenerHistorialChat(lead_id); // debes implementar esto según Kommo API
const respuesta = await analizarMensaje(contexto, mensaje);


if (respuesta.tool_calls) {
const args = JSON.parse(respuesta.tool_calls[0].function.arguments);
const token = await getAccessToken();
await actualizarCamposKommo(lead_id, args, token);
await moverEtapa(lead_id, token);
} else {
await responderKommo(lead_id, respuesta.content);
}


res.status(200).send('OK');
} catch (err) {
console.error('❌ Error en webhook:', err);
res.status(500).send('Error procesando mensaje');
}
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));


async function actualizarCamposKommo(lead_id, args, token) {
const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`;
const body = {
custom_fields_values: Object.entries(args).map(([code, value]) => ({
field_id: code,
values: [{ value }]
}))
};
await axios.patch(url, body, { headers: { Authorization: `Bearer ${token}` } });
}


async function moverEtapa(lead_id, token) {
const url = `https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${lead_id}`;
await axios.patch(url, { pipeline_id: process.env.PIPELINE_ID, status_id: "142" }, {
headers: { Authorization: `Bearer ${token}` }
});
}


async function responderKommo(lead_id, texto) {
// Simula respuesta con webhook o Kommo API de mensajería externa
console.log(`🗨️ RESPUESTA A ENVIAR:
${texto}`);
}

async function obtenerHistorialChat(leadId) {
    try {
        console.log(`[INFO] Obteniendo historial para lead: ${leadId}`);
        // POR AHORA: Retornamos lista vacía para que no falle el servidor.
        // En el futuro aquí conectaremos con la API de Kommo para leer notas anteriores.
        return []; 
    } catch (error) {
        console.error("Error al obtener historial, continuamos sin él:", error);
        return [];
    }
}