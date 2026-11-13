/**
 * OpenAI-compatible Chat Completions: POST /v1/chat/completions.
 * Message content is forwarded as-is, so `{ type: "image_url" }` parts reach vision models.
 * Use this instead of the responses template for DeepSeek / One-API / vLLM style gateways.
 * @param {{role: string, content: string | object[]}[]} messages - includes the system message when present
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} reasoningEffort - "auto" | "low" | "medium" | "high" | "xhigh"; omit reasoning when "auto"
 * @param {function} request
 * @param {function} onDelta - push streaming text
 * @returns {Promise<string>}
 */
async function generateText({
  messages,
  model,
  baseUrl,
  apiKey,
  reasoningEffort,
  request,
  onDelta,
}) {
  const body = {
    model: model,
    messages: messages,
  };
  if (reasoningEffort && reasoningEffort !== "auto") {
    body.reasoning_effort = reasoningEffort;
  }
  const data = await request({
    method: "post",
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    data: body,
  });
  if (data && data.error) {
    throw new Error(data.error.message || "chat completions failed");
  }
  const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? "";
  const text = Array.isArray(content)
    ? content.map((part) => part.text || "").join("")
    : String(content);
  onDelta(text);
  return text;
}

return await generateText({
  messages,
  model,
  baseUrl,
  apiKey,
  reasoningEffort,
  request,
  onDelta,
});
