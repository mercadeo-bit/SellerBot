import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

console.log("--------------- ARRANQUE FINAL ---------------");

const app = express();
app.use(express.json());

// 1. CONFIGURACIÓN DEL PUERTO (CRÍTICO)
// Railway nos da un puerto en process.env.PORT (ej: 8080).
// Debemos usar ese o 3000 si estamos en local.
const PORT = process.env.PORT || 3000;

// Variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

// OpenAI Config
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 2. Ruta para que Railway sepa que estamos vivos (Healthcheck)
// Importante: Railway suele revisar la raíz '/' para ver si da 200 OK.
app.get('/', (req, res) => {
    res.status(200).send('✅ COPACOL AI ONLINE');
});

// 3. Ruta WEBHOOK (Tu lógica de negocio)
app.post('/webhook', async (req, res) => {
    // Respondemos YA para que Kommo no de timeout y para que Railway vea tráfico.
    res.status(200).send('OK');

    try {
        if (!req.body.message) return;
        const data = req.body.message.add ? req.body.message.add[0] : null;
        
        if (data) {
            console.log(`📩 Lead ${data.lead_id} dice: "${data.text}"`);
            
            // --- AQUÍ CONECTAS LA INTELIGENCIA ---
            // Solo para confirmar que funciona, hacemos un log de la IA
            console.log("🧠 Enviando a OpenAI (Simulación activa)...");
            
            // Cuando esto esté estable, descomentas tu lógica completa de Function Calling
        }
    } catch (e) {
        console.error("❌ Error Webhook:", e.message);
    }
});

// 4. ARRANQUE DEL SERVIDOR (LA SOLUCIÓN)
// '0.0.0.0' obliga al servidor a escuchar conexiones desde FUERA del contenedor.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR LISTO EN PUERTO: ${PORT}`);
    console.log(`📡 Escuchando en 0.0.0.0 (Visible para Railway)`);
});