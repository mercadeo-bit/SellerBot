import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

console.log("--------------- INTENTO IPv6 ---------------");

const app = express();
app.use(express.json());

// Railway asigna el puerto automáticamente (ej: 8080)
const PORT = process.env.PORT || 3000;

// Variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 1. Ping / Healthcheck (Railway toca aquí para ver si vives)
app.get('/', (req, res) => {
    res.status(200).send('✅ ONLINE');
});

// 2. Webhook
app.post('/webhook', async (req, res) => {
    // Responder inmediatamente con 200 OK
    res.status(200).send('OK');

    try {
        if (req.body.message) {
            const data = req.body.message.add ? req.body.message.add[0] : null;
            if (data) {
                console.log(`📩 Mensaje: "${data.text}"`);
                console.log("🧠 Enviando a IA (Procesando)...");
                // Aquí se reactivará la lógica de Function Calling cuando esté estable
            }
        }
    } catch (e) {
        console.error("Error Webhook:", e.message);
    }
});

// 3. ARRANQUE FINAL (CAMBIO CRÍTICO: '::')
// '::' significa "Escuchar en todas las direcciones IPv6 e IPv4"
// Esto es lo que Railway espera nativamente.
const server = app.listen(PORT, '::', () => {
    console.log(`🚀 SERVIDOR ESCUCHANDO EN PUERTO ${PORT} (Dual Stack ::)`);
});

// Mantener vivo
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM recibido. Cerrando...');
    server.close(() => console.log('Cerrado.'));
});