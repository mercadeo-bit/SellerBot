import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE RED A PRUEBA DE FALLOS ---
// Usamos el puerto que Railway nos da. Si no nos da ninguno, usamos 3000.
const PORT = process.env.PORT || 3000;

// Variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

// Cliente OpenAI (Inicialización perezosa para evitar crash al inicio)
let openai = null;
if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} else {
    console.error("⚠️ ADVERTENCIA: No se detectó API KEY de OpenAI.");
}

// 1. Ruta HEALTHCHECK (Para que Railway sepa que estamos vivos)
app.get('/', (req, res) => {
    res.status(200).send('✅ COPACOL AI ONLINE');
});

// 2. Ruta WEBHOOK
app.post('/webhook', async (req, res) => {
    // Responder inmediatamente para mantener feliz a Kommo
    res.status(200).send('OK');

    try {
        if (!req.body.message) return;
        
        // Log básico
        const data = req.body.message.add ? req.body.message.add[0] : null;
        if (data) {
            console.log(`📩 Mensaje entrante: "${data.text}" | Lead ID: ${data.lead_id}`);
            
            // AQUÍ IRÍA LA LÓGICA DE OPENAI
            // Por ahora, solo queremos que el servidor NO se apague.
            if (openai) {
                // Simulación de proceso sin bloquear el hilo principal
                console.log("🧠 Enviando a OpenAI (Simulado para estabilidad)...");
            }
        }
    } catch (e) {
        console.error("Error en webhook:", e.message);
    }
});

// 3. ARRANQUE DEL SERVIDOR
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR INICIADO EN PUERTO: ${PORT}`);
    console.log(`📡 Escuchando en 0.0.0.0 (Universal)`);
});

// 4. PREVENCIÓN DE CIERRE (Keep-Alive)
// Esto evita que el servidor se muera si recibe una señal extraña
process.on('SIGTERM', () => {
    console.log('🛑 Recibida señal SIGTERM, pero intentando mantener conexiones...');
    // No cerramos el servidor inmediatamente, dejamos que Railway decida cuándo matar
    server.close(() => {
        console.log('Servidor cerrado correctamente.');
    });
});

process.on('uncaughtException', (err) => {
    console.error('🔥 ERROR NO CAPTURADO:', err);
    // No salimos del proceso (process.exit) para intentar sobrevivir
});