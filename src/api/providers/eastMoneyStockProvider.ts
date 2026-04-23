import * as http from "http";
import { StockData } from "../../models/stock";
import {
  BatchFetchResult,
  MarketDataProvider,
  QuoteErrorInfo,
} from "./types";
import { ProviderResilienceCache } from "./providerResilienceCache";

export class EastMoneyStockProvider implements MarketDataProvider {
  private readonly providerName = "eastmoney_stock";
  private readonly resilience = new ProviderResilienceCache<Map<string, StockData>>({
    successTtlMs: 2000,
    failureBaseBackoffMs: 2000,
    failureMaxBackoffMs: 30000,
  });

  async fetch(stockSecIds: string[], updateTime: string): Promise<BatchFetchResult> {
    const errors = new Map<string, QuoteErrorInfo>();
    if (stockSecIds.length === 0) {
      return { data: new Map(), errors };
    }

    const batchKey = this.buildBatchKey(stockSecIds);
    const now = Date.now();
    const fresh = this.resilience.getFresh(batchKey, now);
    if (fresh) {
      return { data: new Map(fresh), errors };
    }

    if (!this.resilience.canAttempt(batchKey, now)) {
      const fallback = this.resilience.getAny(batchKey);
      if (fallback) {
        return { data: new Map(fallback), errors };
      }
      this.fillBatchError(errors, stockSecIds, "network_error", "请求处于失败退避窗口中");
      return { data: new Map(), errors };
    }

    const secids = stockSecIds.join(",");
    const url = `http://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f12,f13,f14,f2,f4,f3,f18`;

    return new Promise((resolve) => {
      http
        .get(url, (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            const parseErrors = new Map<string, QuoteErrorInfo>();
            const parsed = this.parseResponse(data, updateTime, stockSecIds, parseErrors);
            if (parsed.size > 0) {
              this.resilience.onSuccess(batchKey, parsed);
              resolve({ data: parsed, errors: parseErrors });
              return;
            }

            this.resilience.onFailure(batchKey);
            const fallback = this.resilience.getAny(batchKey);
            if (fallback) {
              resolve({ data: new Map(fallback), errors: new Map() });
              return;
            }

            if (parseErrors.size > 0) {
              resolve({ data: new Map(), errors: parseErrors });
              return;
            }

            this.fillBatchError(errors, stockSecIds, "unsupported_symbol", "未查询到有效行情");
            resolve({ data: new Map(), errors });
          });
        })
        .on("error", (error) => {
          console.error("批量获取股票数据失败:", error);
          this.resilience.onFailure(batchKey);
          const fallback = this.resilience.getAny(batchKey);
          if (fallback) {
            resolve({ data: new Map(fallback), errors: new Map() });
            return;
          }
          this.fillBatchError(errors, stockSecIds, "network_error", String(error));
          resolve({ data: new Map(), errors });
        });
    });
  }

  private buildBatchKey(stockSecIds: string[]): string {
    return stockSecIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .sort()
      .join(",");
  }

  private parseResponse(
    data: string,
    updateTime: string,
    requestedIds: string[],
    errors: Map<string, QuoteErrorInfo>
  ): Map<string, StockData> {
    const result = new Map<string, StockData>();

    try {
      const jsonData = JSON.parse(data);
      const stocks = jsonData?.data?.diff;
      if (!Array.isArray(stocks)) {
        this.fillBatchError(errors, requestedIds, "parse_error", "返回结构缺少 data.diff");
        return result;
      }

      for (const stockData of stocks) {
        if (!stockData) {
          continue;
        }

        const marketCode = stockData.f13;
        const code = stockData.f12;
        const stockCode = `${marketCode}.${code}`;
        const name = stockData.f14 || stockCode;

        const isHKorUS = marketCode === 116 || marketCode === 105 || marketCode === 106 || marketCode === 107;
        const divisor = isHKorUS ? 1000 : 100;
        const decimals = isHKorUS ? 3 : 2;

        const current = (stockData.f2 / divisor).toFixed(decimals);
        const changePercent = (stockData.f3 / 100).toFixed(2);
        const change = (stockData.f4 / divisor).toFixed(decimals);
        const previousClose = (stockData.f18 / divisor).toFixed(decimals);

        result.set(stockCode, {
          code: stockCode,
          name,
          current,
          change,
          changePercent,
          previousClose,
          updateTime,
        });
      }

      for (const requested of requestedIds) {
        if (!result.has(requested)) {
          errors.set(requested, {
            type: "unsupported_symbol",
            provider: this.providerName,
            message: `symbol ${requested} 未命中数据`,
          });
        }
      }
    } catch (error) {
      console.error("批量解析股票数据错误:", error);
      this.fillBatchError(errors, requestedIds, "parse_error", String(error));
    }

    return result;
  }

  private fillBatchError(
    errors: Map<string, QuoteErrorInfo>,
    ids: string[],
    type: QuoteErrorInfo["type"],
    message: string
  ): void {
    for (const id of ids) {
      errors.set(id, {
        type,
        provider: this.providerName,
        message,
      });
    }
  }
}
