import * as http from "http";
import { StockData } from "../../models/stock";
import {
  BatchFetchResult,
  MarketDataProvider,
  QuoteErrorInfo,
  QuoteErrorType,
} from "./types";
import { ProviderResilienceCache } from "./providerResilienceCache";

interface SectorFetchResult {
  data: StockData | null;
  errorType?: QuoteErrorType;
  message?: string;
}

export class TonghuashunSectorProvider implements MarketDataProvider {
  private readonly providerName = "tonghuashun_sector";
  private readonly resilience = new ProviderResilienceCache<StockData>({
    successTtlMs: 2000,
    failureBaseBackoffMs: 2000,
    failureMaxBackoffMs: 30000,
  });

  async fetch(sectorCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    const result = new Map<string, StockData>();
    const errors = new Map<string, QuoteErrorInfo>();
    if (sectorCodes.length === 0) {
      return { data: result, errors };
    }

    await Promise.all(
      sectorCodes.map(async (code) => {
        const normalizedCode = code.trim().toUpperCase();
        if (!normalizedCode) {
          return;
        }

        const key = `sector:${normalizedCode}`;
        const now = Date.now();
        const fresh = this.resilience.getFresh(key, now);
        if (fresh) {
          result.set(normalizedCode, fresh);
          return;
        }

        if (!this.resilience.canAttempt(key, now)) {
          const fallback = this.resilience.getAny(key);
          if (fallback) {
            result.set(normalizedCode, fallback);
          } else {
            errors.set(normalizedCode, this.buildError("network_error", "请求处于失败退避窗口中"));
          }
          return;
        }

        const fetched = await this.fetchSector(normalizedCode, updateTime);
        if (fetched.data) {
          this.resilience.onSuccess(key, fetched.data);
          result.set(normalizedCode, fetched.data);
          return;
        }

        this.resilience.onFailure(key);
        const fallback = this.resilience.getAny(key);
        if (fallback) {
          result.set(normalizedCode, fallback);
          return;
        }
        errors.set(
          normalizedCode,
          this.buildError(fetched.errorType ?? "unsupported_symbol", fetched.message ?? "未查询到有效行情")
        );
      })
    );

    return { data: result, errors };
  }

  private fetchSector(code: string, updateTime: string): Promise<SectorFetchResult> {
    const url = `http://d.10jqka.com.cn/v6/realhead/bk_${code}/last.js`;
    return new Promise((resolve) => {
      http
        .get(url, (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            resolve(this.parseSectorResponse(data, code, updateTime));
          });
        })
        .on("error", (error) => {
          console.error(`获取板块数据失败: ${code}`, error);
          resolve({
            data: null,
            errorType: "network_error",
            message: String(error),
          });
        });
    });
  }

  private parseSectorResponse(data: string, code: string, updateTime: string): SectorFetchResult {
    try {
      const matched = data.match(/\((\{.*\})\)\s*$/);
      if (!matched?.[1]) {
        return {
          data: null,
          errorType: "parse_error",
          message: "返回结构不符合预期",
        };
      }

      const parsed = JSON.parse(matched[1]);
      const items = parsed?.items;
      if (!items || typeof items !== "object") {
        return {
          data: null,
          errorType: "parse_error",
          message: "返回结构缺少 items 字段",
        };
      }

      const currentNum = this.toNumber(items["10"]);
      if (!Number.isFinite(currentNum)) {
        return {
          data: null,
          errorType: "unsupported_symbol",
          message: "无有效 current 字段，可能是无效板块代码",
        };
      }

      const previousNum = this.toNumber(items["6"]);
      const changeNum = this.toNumber(items["264648"]);
      const changePercentNum = this.toNumber(items["199112"]);

      const previousClose = Number.isFinite(previousNum)
        ? previousNum
        : currentNum - (Number.isFinite(changeNum) ? changeNum : 0);
      const change = Number.isFinite(changeNum) ? changeNum : currentNum - previousClose;
      const changePercent =
        Number.isFinite(changePercentNum)
          ? changePercentNum
          : previousClose !== 0
            ? (change / previousClose) * 100
            : 0;

      return {
        data: {
          code: `bk.${code}`,
          name: String(items.name || code),
          current: currentNum.toFixed(3),
          change: change.toFixed(3),
          changePercent: changePercent.toFixed(2),
          previousClose: previousClose.toFixed(3),
          updateTime,
        },
      };
    } catch (error) {
      console.error(`解析板块数据失败: ${code}`, error);
      return {
        data: null,
        errorType: "parse_error",
        message: String(error),
      };
    }
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

  private buildError(type: QuoteErrorType, message: string): QuoteErrorInfo {
    return {
      type,
      provider: this.providerName,
      message,
    };
  }
}
