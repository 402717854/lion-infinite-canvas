/**
 * OpenAI image generation and editing.
 * Text-to-image uses POST /v1/images/generations (JSON) when images is empty.
 * Image editing uses POST /v1/images/edits (multipart) when images has data URLs.
 * @param {string} prompt
 * @param {string[]} images - reference images as data URLs; empty for text-to-image
 * @param {object} params
 * @param {string} params.size - output size, e.g. "1024x1024" or "auto"
 * @param {string} params.quality - "low" | "medium" | "high" | "xhigh" | "max"
 * @param {number} params.count - number of images
 * @param {string} [params.background] - "transparent" when requested
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {function} request - raw HTTP helper; relative urls join baseUrl without /v1
 * @returns {Promise<string[]>} image URLs or data URLs
 */
async function generateImage({
  prompt,
  images,
  params: {
    size,
    quality,
    count,
    background,
  },
  model,
  baseUrl,
  apiKey,
  request,
}) {
  if (images.length === 0) {
    const data = await request({
      method: "post",
      url: `${baseUrl}/v1/images/generations`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        model: model,
        prompt: prompt,
        n: count,
        size: size,
        quality: quality,
        background: background,
        response_format: "b64_json",
      },
    });
    const urls = [];
    for (const item of data.data || []) {
      urls.push(item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url);
    }
    return urls;
  }

  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("n", String(count));
  form.set("size", size);
  form.set("quality", quality);
  form.set("background", background);
  form.set("response_format", "b64_json");
  const imageField = images.length > 1 ? "image[]" : "image";
  for (const dataUrl of images) {
    form.append(imageField, await (await fetch(dataUrl)).blob(), "ref.png");
  }
  const edited = await request({
    method: "post",
    url: `${baseUrl}/v1/images/edits`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    data: form,
  });
  const urls = [];
  for (const item of edited.data || []) {
    urls.push(item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url);
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