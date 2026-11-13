/**
 * OpenAI text: POST /v1/responses.
 * @param {{role: string, content: string}[]} messages - includes the system message when present
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
    input: messages,
  };
  if (reasoningEffort && reasoningEffort !== "auto") {
    body.reasoning = {
      effort: reasoningEffort,
    };
  }
  const data = await request({
    method: "post",
    url: `${baseUrl}/v1/responses`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    data: body,
  });
  const text = data.output_text
    || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("")
    || "";
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
