import * as http from "http";
import { StockData } from "../../models/stock";
import { MarketDataProvider } from "./types";

export class TonghuashunSectorProvider implements MarketDataProvider {
  async fetch(sectorCodes: string[], updateTime: string): Promise<Map<string, StockData>> {
    const result = new Map<string, StockData>();
    if (sectorCodes.length === 0) {
      return result;
    }

    await Promise.all(
      sectorCodes.map(async (code) => {
        const data = await this.fetchSector(code, updateTime);
        if (data) {
          result.set(code, data);
        }
      })
    );

    return result;
  }

  private fetchSector(code: string, updateTime: string): Promise<StockData | null> {
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
          resolve(null);
        });
    });
  }

  private parseSectorResponse(data: string, code: string, updateTime: string): StockData | null {
    try {
      const matched = data.match(/\((\{.*\})\)\s*$/);
      if (!matched?.[1]) {
        return null;
      }

      const parsed = JSON.parse(matched[1]);
      const items = parsed?.items;
      if (!items || typeof items !== "object") {
        return null;
      }

      const currentNum = this.toNumber(items["10"]);
      if (!Number.isFinite(currentNum)) {
        return null;
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
        code: `bk.${code}`,
        name: String(items.name || code),
        current: currentNum.toFixed(3),
        change: change.toFixed(3),
        changePercent: changePercent.toFixed(2),
        previousClose: previousClose.toFixed(3),
        updateTime,
      };
    } catch (error) {
      console.error(`解析板块数据失败: ${code}`, error);
      return null;
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
}
