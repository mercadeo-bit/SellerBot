import { OpenAI } from 'openai';


const SYSTEM_PROMPT = `
Eres Sofía, asesora digital de COPACOL. Tu meta es asesorar y cerrar ventas ferreteras creando alianzas.
TONO: Cálido, empático, profesional, optimista.
REGLAS:
- Siempre saluda por el nombre.
- Preséntate: "Te escribe Sofía, asesora digital de COPACOL".
- Explica técnicamente (marcas, calidades, presión).
- Cierra con preguntas que lleven al sí.
- Emojis permitidos (máx 2): 🙏🏽, 👌🏽, 💪🏽, 🙂, 🤝.
- Estructura: Alianza → Diagnóstico → Propuesta → Cierre.
- Prioriza marca Furius.
`;


const tools = [
{
type: "function",
function: {
name: "update_delivery_info",
description: "Extrae datos del cliente para preparar despacho.",
parameters: {
type: "object",
properties: {
ms_nombre_completo: { type: "string" },
ms_documento_numero: { type: "string" },
ms_direccion_exacta: { type: "string" },
ms_ciudad: { type: "string" },
ms_telefono: { type: "string" }
},
required: [
"ms_nombre_completo",
"ms_documento_numero",
"ms_direccion_exacta",
"ms_ciudad",
"ms_telefono"
]
}
}
}
];


export async function analizarMensaje(contexto, mensaje) {
const response = await openai.chat.completions.create({
model: "gpt-4-1106-preview",
temperature: 0.7,
messages: [
{ role: "system", content: SYSTEM_PROMPT },
...contexto,
{ role: "user", content: mensaje }
],
tools
});
return response.choices[0].message;
}