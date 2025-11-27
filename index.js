import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN CRÍTICA ---
// No definimos IP fija. Dejamos que Railway decida (IPv6/IPv4)
const PORT = process.env.PORT || 3000;

// Variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;

// Cliente OpenAI
let openai = null;
if (OPENAI_API_KEY) {
    try {
        openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        console.log("✅ OpenAI configurado.");
    } catch (e) {
        console.error("❌ Error config OpenAI:", e.message);
    }
}

// 1. Ruta HEALTHCHECK (Ping)
app.get('/', (req, res) => {
    res.status(200).send('✅ COPACOL AI ONLINE');
});

// 2. Ruta WEBHOOK
app.post('/webhook', async (req, res) => {
    res.status(200).send('OK'); // Responder YA para evitar timeout

    try {
        if (!req.body.message) return;
        const data = req.body.message.add ? req.body.message.add[0] : null;
        
        if (data) {
            console.log(`📩 Mensaje de Lead ${data.lead_id}: "${data.text}"`);
            
            // Lógica OpenAI Simula
            if (openai) {
                // Aquí iría el código completo de venta.
                // Lo simplificamos para asegurar que el server no se caiga primero.
                console.log("🧠 Procesando con IA (Simulado)...");
            }
        }
    } catch (e) {
        console.error("Error en webhook:", e.message);
    }
});

// 3. ARRANQUE UNIVERSAL (FIX FINAL)
// Quitamos '0.0.0.0' para permitir IPv6 que es lo que usa Railway
app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR LISTO EN PUERTO: ${PORT}`);
});

// Manejo de errores para evitar cierres
process.on('uncaughtException', (err) => console.error('🔥 Error no capturado:', err));