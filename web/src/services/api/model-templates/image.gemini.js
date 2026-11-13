/**
 * Gemini image generation via models/{model}:generateContent.
 * Reference images go into parts.inline_data. size maps to aspectRatio, resolution maps to imageSize; Gemini has no quality parameter.
 * @param {string} prompt
 * @param {string[]} images - reference images as data URLs
 * @param {object} params
 * @param {string} params.size - "2048x2048", "16:9", "auto", etc.; sent as aspectRatio
 * @param {string} params.resolution - "1k" | "2k" | "4k" | "auto"; sent as imageSize
 * @param {string} params.quality - "low" | "medium" | "high" | "xhigh" | "max"; unused here
 * @param {number} params.count - number of generateContent calls
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {function} request
 * @returns {Promise<string[]>} image data URLs
 */
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

async function generateImage({
  prompt,
  images,
  params: {
    size,
    resolution,
    count,
  },
  model,
  baseUrl,
  apiKey,
  request,
}) {
  const parts = [{ text: prompt }];
  for (const dataUrl of images) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      parts.push({
        inline_data: {
          mime_type: match[1],
          data: match[2],
        },
      });
    }
  }

  let aspectRatio = "1:1";
  if (size && size !== "auto") {
    const pixels = size.match(/^(\d+)x(\d+)$/);
    if (pixels) {
      const width = Number(pixels[1]);
      const height = Number(pixels[2]);
      const divisor = gcd(width, height);
      aspectRatio = `${width / divisor}:${height / divisor}`;
    } else if (size.includes(":")) {
      aspectRatio = size;
    }
  }
  const imageSize = resolution && resolution !== "auto" ? resolution.toUpperCase() : undefined;
  const n = Number(count) || 1;
  const urls = [];

  for (let i = 0; i < n; i++) {
    const data = await request({
      method: "post",
      url: `${baseUrl}/v1beta/models/${model}:generateContent`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      data: {
        contents: [
          {
            role: "user",
            parts: parts,
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: imageSize,
          },
        },
      },
    });
    for (const candidate of data.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        const img = part.inlineData || part.inline_data;
        if (img && img.data) {
          urls.push(`data:${img.mimeType || img.mime_type || "image/png"};base64,${img.data}`);
        }
      }
    }
  }
  return urls;
}

return await generateImage({
  prompt,
  images,
  params,
  model,
  baseUrl,
  apiKey,
  request,
});