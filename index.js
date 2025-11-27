import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

// 1. Cargar variables
dotenv.config();

console.log("--------------- INICIO DEL ARRANQUE ---------------");

// 2. Verificar Variables Críticas (Diagnóstico)
const requiredVars = ['OPENAI_API_KEY', 'KOMMO_ACCESS_TOKEN', 'KOMMO_SUBDOMAIN'];
const missingVars = requiredVars.filter(key => !process.env[key]);

if (missingVars.length > 0) {
    console.error(`❌ CRÍTICO: Faltan las siguientes variables de entorno: ${missingVars.join(', ')}`);
    console.error("El servidor iniciará pero NO funcionará correctamente hasta que las agregues en Railway.");
} else {
    console.log("✅ Todas las variables críticas parecen estar presentes.");
}

// 3. Configurar Express
const app = express();
app.use(express.json());

// 4. Inicializar OpenAI con protección
let openai;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log("✅ Cliente OpenAI inicializado.");
    } else {
        console.warn("⚠️ OMITIDO: Cliente OpenAI no se inició (Falta API Key).");
    }
} catch (error) {
    console.error("❌ Error inicializando OpenAI:", error.message);
}

// 5. Ruta de Webhook
app.post('/webhook', async (req, res) => {
    console.log("📩 Webhook recibido");
    // Solo devolvemos OK por ahora para probar conectividad
    res.status(200).send('OK - Servidor Vivo');
    
    // Aquí iría la lógica compleja, pero primero aseguremos que el servidor PRENDA.
    if (openai && req.body.message) {
       console.log("Procesando lógica... (Logs detallados en versiones futuras)");
    }
});

// 6. Ruta de prueba (Ping)
app.get('/', (req, res) => {
    res.send('🤖 COPACOL AI: El servidor está funcionando correctamente.');
});

// 7. ARRANQUE DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', (err) => {
    if (err) {
        console.error("❌ Error al intentar escuchar en el puerto:", err);
    } else {
        console.log(`🚀 SERVIDOR ACTIVO Y ESCUCHANDO EN PUERTO ${PORT}`);
        console.log("--------------- ARRANQUE EXITOSO ---------------");
    }
});