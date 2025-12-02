import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // UPDATED NAME
});

const SYSTEM_PROMPT = `
Eres Sofía, asesora digital de COPACOL. 
OBJETIVO: Calificar leads y cerrar ventas.
IDIOMA: Español.
REGLAS:
- Respuesta CORTA (ideales para WhatsApp).
- Tono amable y profesional.
- Si piden despacho, pregunta ciudad y datos antes de llamar a la función.
`;

const tools = [
    {
        type: "function",
        function: {
            name: "update_delivery_info",
            description: "Guardar datos de despacho cuando el cliente confirme la compra.",
            parameters: {
                type: "object",
                properties: {
                    cedula: { type: "string" },
                    direccion: { type: "string" },
                    ciudad: { type: "string" }
                },
                required: ["direccion", "ciudad"]
            }
        }
    }
];

export async function analizarMensaje(contexto, mensajeUsuario) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo", // or gpt-3.5-turbo if you prefer cost savings
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...contexto,
                { role: "user", content: mensajeUsuario }
            ],
            tools: tools,
            tool_choice: "auto",
            temperature: 0.5,
        });
        return response.choices[0].message;
    } catch (error) {
        console.error("❌ OpenAI API Error:", error);
        return { content: "Estoy experimentando un problema técnico. ¿Me repites?" };
    }
}