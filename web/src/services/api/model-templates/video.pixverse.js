/**
 * Pixverse image-driven video: POST /pixverse/video/img/generate, then poll
 * GET /pixverse/video/result/{video_id} until status becomes 1.
 * status: 1 = done, 5 = generating, 7 = moderation failed, 8 = generation failed.
 * Note: before status=1 the url is not playable; after status=1 the url may hit
 * browser cache and show "cannot play" - clear cache / use incognito to re-open.
 *
 * @param {string} prompt
 * @param {string[]} images - reference images as data URLs (data:image/xxx;base64,)
 * @param {File[]} videos - reference videos; empty when none (unused by this endpoint)
 * @param {File[]} audios - reference audio; empty when none (unused by this endpoint)
 * @param {object} params
 * @param {string} params.mode - "frames" or "reference"; only the first image is sent here
 * @param {string|number} params.seconds - sent as duration
 * @param {string} params.size - output size, e.g. "1280x720"; mapped to aspect_ratio when ratio is absent
 * @param {string} params.ratio - aspect ratio, e.g. "16:9" -> aspect_ratio
 * @param {string} params.resolution - e.g. "720p" -> quality
 * @param {boolean} params.generateAudio
 * @param {boolean} params.watermark
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {function} request - raw HTTP request
 * @param {function} poll - poll(request, extract, {intervalMs, timeoutMs})
 * @param {AbortSignal} signal - cancellation signal
 * @returns {Promise<{url: string}>}
 */
async function generateVideo({
                                 prompt,
                                 images,
                                 videos,
                                 audios,
                                 params: {
                                     mode,
                                     seconds,
                                     size,
                                     quality,
                                     resolution,
                                     ratio,
                                     generateAudio,
                                     watermark,
                                 },
                                 model,
                                 baseUrl,
                                 apiKey,
                                 request,
                                 poll,
                                 signal,
                             }) {
    // baseUrl 只做 trim，这里再去掉尾部斜杠，避免拼出 "//pixverse"
    const base = baseUrl.replace(/\/+$/, "");

    // dataURL(base64) 转 Blob
    function dataUrlToBlob(dataUrl) {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    // 上传接口：POST /pixverse/image/upload
    // form: model + image(file)
    // 返回 Resp.img_url
    async function uploadDataUrl(dataUrl, modelName) {
        const blob = dataUrlToBlob(dataUrl);
        const form = new FormData();
        form.append("model", modelName);
        form.append("image", blob, "ref_img.png");

        const uploadResp = await request({
            method: "post",
            url: `${base}/pixverse/image/upload`,
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            data: form,
            signal,
        });

        if (uploadResp.ErrCode && uploadResp.ErrCode !== 0) {
            throw new Error(uploadResp.ErrMsg || "图片上传失败");
        }
        const imgUrl = uploadResp.Resp?.img_url;
        if (!imgUrl) {
            throw new Error("上传成功，但未返回 img_url");
        }
        const img_id = uploadResp.Resp?.img_id;
        return img_id;
    }

    const aspectRatioMap = {
        "1280x720": "16:9",
        "1920x1080": "16:9",
        "720x1280": "9:16",
        "1080x1920": "9:16",
    };
    let aspectRatio = ratio || size || "16:9";
    if (aspectRatioMap[aspectRatio]) {
        aspectRatio = aspectRatioMap[aspectRatio];
    }
    if (aspectRatio === "auto") {
        aspectRatio = "16:9";
    }

    const body = {
        model: model,
        prompt: prompt,
        duration: Number(seconds) || 5,
        quality: String(resolution || quality || "720p"),
        generate_audio: !!generateAudio,
        watermark: !!watermark,
    };

    // 上传第一张 base64 参考图，拿到 img_url 填入 image 字段
    if (images && images[0]) {
        const remoteImgId = await uploadDataUrl(images[0], model);
        body.img_id = remoteImgId;
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
    };

    const created = await request({
        method: "post",
        url: `${base}/pixverse/video/img/generate`,
        headers,
        data: body,
        signal,
    });
    if (created.ErrCode && created.ErrCode !== 0) {
        throw new Error(created.ErrMsg || "pixverse task creation failed");
    }
    const resp = created.Resp || created;
    const videoId = resp.video_id || resp.id;
    if (!videoId) {
        throw new Error("pixverse did not return a task id");
    }

    return await poll(
        () => request({
            method: "get",
            url: `${base}/pixverse/video/result/${videoId}`,
            headers,
            signal,
        }),
        (state) => {
            if (state.ErrCode && state.ErrCode !== 0) {
                throw new Error(state.ErrMsg || "pixverse poll failed");
            }
            const s = state.Resp || state;
            // status: 1 = done, 5 = generating, 7 = moderation failed, 8 = generation failed
            if (s.status === 1) {
                if (s.url || s.video_url) {
                    return { url: s.url || s.video_url };
                }
                throw new Error("pixverse task is done but returned no url");
            }
            if (s.status === 7) {
                throw new Error("pixverse moderation failed, check the input content");
            }
            if (s.status === 8) {
                throw new Error("pixverse video generation failed");
            }
            return null;
        },
        { intervalMs: 5000, timeoutMs: 300000 },
    );
}

return await generateVideo({
    prompt,
    images,
    videos,
    audios,
    params,
    model,
    baseUrl,
    apiKey,
    request,
    poll,
    signal,
});
