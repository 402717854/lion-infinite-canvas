/**
 * OpenAI speech: POST /v1/audio/speech.
 * @param {string} prompt - text to speak
 * @param {object} params
 * @param {string} params.voice
 * @param {string} params.format - response_format, e.g. "mp3"
 * @param {string|number} params.speed
 * @param {string} [params.instructions] - voice style instructions
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {function} request
 * @returns {Promise<Blob>}
 */
async function generateAudio({
  prompt,
  params: {
    voice,
    format,
    speed,
    instructions,
  },
  model,
  baseUrl,
  apiKey,
  request,
}) {
  return await request({
    method: "post",
    url: `${baseUrl}/v1/audio/speech`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    responseType: "blob",
    data: {
      model: model,
      input: prompt,
      voice: voice,
      response_format: format,
      speed: Number(speed),
      instructions: instructions,
    },
  });
}

return await generateAudio({
  prompt,
  params,
  model,
  baseUrl,
  apiKey,
  request,
});