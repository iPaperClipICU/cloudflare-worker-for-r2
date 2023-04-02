const CACHE_ID = "2";

export interface Env {
  R2: R2Bucket;
};

const parseRange = (encoded: string | null): undefined | {
  offset: number;
  end?: number;
} => {
  if (encoded === null) return;

  const parts = encoded.split("bytes=")[1]?.split("-") ?? [];
  if (parts.length !== 2) return undefined;

  const range = {
    offset: Number(parts[0]),
    end: Number(parts[1]),
  };

  if (range.end === 0) return {
    offset: range.offset,
  };
  else return range;
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const ERROR_403 = new Response(null, { status: 403 });

    const url = new URL(request.url);

    if (
      url.hostname !== "cf.ipaperclip-icu.cyou" &&
      url.hostname !== "ipaperclip-file.xodvnm.cn"
    ) return ERROR_403;
    if (!/^https:\/\/ipaperclip\.icu.*$/.test(request.headers.get("referer") ?? "")) return ERROR_403;
    if (request.method !== "GET") return ERROR_403;

    ERROR_403.headers.set("Cache-Control", "max-age=600");

    const range = parseRange(request.headers.get("range"));
    const cache = caches.default;
    const cacheKey =
      "https://cache.ipaperclip.icu/" +
      (range === undefined ? `${CACHE_ID}_${url.pathname}` : `${CACHE_ID}_${url.pathname}_${range.offset}_${range.end}`);
    // {CACHE_ID}_{url.pathname}_{range.offset?}_{range.end?}
    let response = await cache.match(cacheKey);

    if (!response) {
      console.log(`Cache MISS: ${cacheKey}`);
      let cacheResponse: Response | null = null;

      const fileUrl = decodeURI(url.pathname.slice(1));
      const object = await env.R2.get(fileUrl, { range });

      if (object === null) {
        console.log(`Object not found: ${fileUrl}`);
        response = ERROR_403;
        cacheResponse = ERROR_403;
      } else {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        const nowTime = new Date(Date.now() + 604800000).toUTCString();
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "max-age=604800");
        headers.set("Expires", nowTime);
        headers.set("Last-Modified", nowTime);
        if (range !== undefined) {
          if (range.end === undefined) range.end = object.size - 1;
          headers.set("Accept-Ranges", "bytes");
          headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${object.size}`);
        };
        if (request.headers.get("Connection") === "keep-alive") headers.set("Connection", "keep-alive");

        const objectBodys = object.body.tee();
        response = new Response(objectBodys[0], {
          headers,
          status: range === undefined ? 200 : 206,
        });
        cacheResponse = new Response(objectBodys[1], {
          headers,
          status: 200,
          statusText: range === undefined ? "OK" : "Partial Content"
        });
      };

      // 缓存
      ctx.waitUntil(cache.put(cacheKey, cacheResponse));
      response.headers.set("X-Cache", "MISS");
    } else {
      console.log(`Cache HIT: ${cacheKey}`);

      if (response.statusText === "Partial Content") {
        // 修改 response 的 status 为 206
        response = new Response(response.body, {
          headers: response.headers,
          status: 206,
        });
      };

      response.headers.set("X-Cache", "HIT");
    };

    return response;
  },
};
