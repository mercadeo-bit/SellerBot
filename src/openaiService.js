import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY
});

const SYSTEM_PROMPT = `
Eres Sofía, asesora digital de COPACOL. Tu meta es asesorar y cerrar ventas ferreteras creando alianzas.
TONO: Cálido, empático, profesional, optimista.
REGLAS:
- Siempre saluda por el nombre si lo conoces.
- Preséntate: "Te escribe Sofía, asesora digital de COPACOL".
- Explica técnicamente (marcas, calidades, presión).
- Cierra con preguntas que lleven al sí.
- Emojis permitidos (máx 2): 🙏🏽, 👌🏽, 💪🏽, 🙂, 🤝.
- Estructura: Alianza → Diagnóstico → Propuesta → Cierre.
- Prioriza marca Furius.
- IDIOMA: Responde en Español.
- MENSAJES CORTOS: Estás en WhatsApp, no escribas párrafos largos.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Extrae datos del cliente para preparar despacho cuando el cliente confirme la compra.",
            parameters: {
                type: "object",
                properties: {
                    ms_nombre_completo: { type: "string" },
                    ms_documento_numero: { type: "string" },
                    ms_direccion_exacta: { type: "string" },
                    ms_ciudad: { type: "string" },
                    ms_telefono: { type: "string" }
                },
                required: ["ms_nombre_completo", "ms_telefono"]
            }
        }
    }
];

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo", // Better for complex sales logic
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...contexto, // History of previous chat
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.7,
        });

        return completion.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI Error:", error);
        return { content: "Lo siento, tuve un error técnico. ¿Me repites?" };
    }
}