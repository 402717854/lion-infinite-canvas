/**
 * Gemini text: POST models/{model}:generateContent.
 * System messages are skipped in contents; systemPrompt goes to systemInstruction.
 * @param {{role: string, content: string}[]} messages
 * @param {string} systemPrompt
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {function} request
 * @param {function} onDelta - push streaming text
 * @returns {Promise<string>}
 */
async function generateText({
  messages,
  systemPrompt,
  model,
  baseUrl,
  apiKey,
  request,
  onDelta,
}) {
  const contents = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }
  const body = {
    contents: contents,
  };
  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }
  const data = await request({
    method: "post",
    url: `${baseUrl}/v1beta/models/${model}:generateContent`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    data: body,
  });
  let text = "";
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    text += part.text || "";
  }
  onDelta(text);
  return text;
}

return await generateText({
  messages,
  systemPrompt,
  model,
  baseUrl,
  apiKey,
  request,
  onDelta,
});