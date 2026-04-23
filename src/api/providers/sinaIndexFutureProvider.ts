import * as https from "https";
import { TextDecoder } from "util";
import { StockData } from "../../models/stock";

type FetchMode = "index" | "future";

export class SinaIndexFutureProvider {
  async fetchIndices(rawCodes: string[], updateTime: string): Promise<Map<string, StockData>> {
    return this.fetchByMode(rawCodes, updateTime, "index");
  }

  async fetchFutures(rawCodes: string[], updateTime: string): Promise<Map<string, StockData>> {
    return this.fetchByMode(rawCodes, updateTime, "future");
  }

  private async fetchByMode(rawCodes: string[], updateTime: string, mode: FetchMode): Promise<Map<string, StockData>> {
    const result = new Map<string, StockData>();
    if (rawCodes.length === 0) {
      return result;
    }

    await Promise.all(
      rawCodes.map(async (rawCode) => {
        const data = await this.fetchSingle(rawCode, updateTime, mode);
        if (data) {
          result.set(rawCode.trim().toUpperCase(), data);
        }
      })
    );

    return result;
  }

  private async fetchSingle(rawCode: string, updateTime: string, mode: FetchMode): Promise<StockData | null> {
    const normalized = rawCode.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    const candidates =
      mode === "future"
        ? this.buildFutureCandidates(normalized)
        : this.buildIndexCandidates(normalized);

    for (const candidate of candidates) {
      const payload = await this.requestSinaPayload(candidate);
      if (!payload) {
        continue;
      }

      const parsed = this.parseByCode(candidate, normalized, payload, updateTime, mode);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private buildIndexCandidates(code: string): string[] {
    if (code.startsWith("GB_") || code.startsWith("RT_HK")) {
      return [code.toLowerCase()];
    }

    if (code === "HSI") {
      return ["rt_hkHSI"];
    }
    if (code === "IXIC") {
      return ["gb_ixic"];
    }
    if (code === "DJI") {
      return ["gb_dji", "gb_djia"];
    }
    if (code === "SPX") {
      return ["gb_inx", "gb_spx"];
    }

    return [`gb_${code.toLowerCase()}`];
  }

  private buildFutureCandidates(code: string): string[] {
    if (code.startsWith("NF_") || code.startsWith("HF_")) {
      const [prefix, ...rest] = code.split("_");
      const symbol = rest.join("_").toUpperCase();
      return [`${prefix.toLowerCase()}_${symbol}`];
    }

    // Future routing is type-priority: never fall back to gb_ stock channel.
    if (this.isLikelyInternationalFuture(code)) {
      return [`hf_${code.toUpperCase()}`, `nf_${code.toUpperCase()}`];
    }

    return [`nf_${code.toUpperCase()}`, `hf_${code.toUpperCase()}`];
  }

  private isLikelyInternationalFuture(code: string): boolean {
    // CL / XAU / GC style pure-letter symbols are treated as international futures first.
    return /^[A-Z]{2,6}$/.test(code);
  }

  private requestSinaPayload(requestCode: string): Promise<string> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: "GET",
          hostname: "hq.sinajs.cn",
          path: `/list=${requestCode}`,
          headers: {
            Referer: "https://finance.sina.com.cn",
            "User-Agent": "Mozilla/5.0",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("end", () => {
            const body = this.decodeBody(chunks);
            const line = body
              .split("\n")
              .find((it) => it.startsWith(`var hq_str_${requestCode}=`));
            if (!line) {
              resolve("");
              return;
            }
            const matched = line.match(/^var\s+hq_str_[^=]+=\"(.*)\";?$/);
            resolve(matched?.[1] ?? "");
          });
        }
      );

      req.on("error", (error) => {
        console.error("获取新浪指数/期货数据失败:", error);
        resolve("");
      });

      req.end();
    });
  }

  private decodeBody(chunks: Buffer[]): string {
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      return "";
    }

    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }

  private parseByCode(
    requestCode: string,
    code: string,
    payload: string,
    updateTime: string,
    mode: FetchMode
  ): StockData | null {
    if (mode === "index") {
      if (requestCode.startsWith("gb_")) {
        return this.parseGlobalIndex(code, requestCode, payload, updateTime);
      }
      if (requestCode.startsWith("rt_hk")) {
        return this.parseRealtimeHkIndex(code, requestCode, payload, updateTime);
      }
      return null;
    }

    if (requestCode.startsWith("nf_")) {
      return this.parseDomesticFuture(code, requestCode, payload, updateTime);
    }
    if (requestCode.startsWith("hf_")) {
      return this.parseOverseasFuture(code, requestCode, payload, updateTime);
    }
    return null;
  }

  private parseGlobalIndex(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    const name = p[0] || code;
    const current = this.toNumber(p[1]);
    const changePercent = this.toNumber(p[2]);
    const change = this.toNumber(p[4]);

    if (!Number.isFinite(current)) {
      return null;
    }

    const previousClose = Number.isFinite(change) ? current - change : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseRealtimeHkIndex(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    const name = p[1] || code;
    const current = this.toNumber(p[2]);
    const previousClose = this.toNumber(p[6]);
    const change = this.toNumber(p[7]);
    const changePercent = this.toNumber(p[8]);

    if (!Number.isFinite(current)) {
      return null;
    }

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseDomesticFuture(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");

    let name = code;
    let current = Number.NaN;
    let previousClose = Number.NaN;

    if (p.length > 6 && Number.isNaN(this.toNumber(p[0]))) {
      // Commodity futures: name,time,open,prevClose,current,...
      name = p[0] || code;
      previousClose = this.toNumber(p[3]);
      current = this.toNumber(p[4]);
    } else {
      // Financial futures: open,high,low,current,...,prevClose(index 13)
      current = this.toNumber(p[3]);
      previousClose = this.toNumber(p[13]);
    }

    if (!Number.isFinite(current)) {
      return null;
    }

    const change = Number.isFinite(previousClose) ? current - previousClose : Number.NaN;
    const changePercent =
      Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(previousClose) ? previousClose.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private parseOverseasFuture(code: string, requestCode: string, payload: string, updateTime: string): StockData | null {
    const p = payload.split(",");
    // hf_* usually: latest, bid/ask..., high, low, time, open, prevClose, ..., date, name
    const current = this.toNumber(p[0]);
    const previousClose = this.toNumber(p[8]);
    const fallbackPrev = this.toNumber(p[7]);
    const name = p[13] || code;

    if (!Number.isFinite(current)) {
      return null;
    }

    const prev = Number.isFinite(previousClose)
      ? previousClose
      : Number.isFinite(fallbackPrev)
        ? fallbackPrev
        : Number.NaN;
    const change = Number.isFinite(prev) ? current - prev : Number.NaN;
    const changePercent = Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : Number.NaN;

    return {
      code: requestCode,
      name,
      current: current.toFixed(3),
      change: Number.isFinite(change) ? change.toFixed(3) : "0.000",
      changePercent: Number.isFinite(changePercent) ? changePercent.toFixed(2) : "0.00",
      previousClose: Number.isFinite(prev) ? prev.toFixed(3) : current.toFixed(3),
      updateTime,
    };
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value !== "string") {
      return Number.NaN;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return Number.NaN;
    }
    return Number(trimmed);
  }
}
