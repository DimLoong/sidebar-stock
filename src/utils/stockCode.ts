import { HoldingInfo, StockConfigItem } from "../models/stock";

const VALID_MARKETS = new Set(["0", "1", "105", "106", "107", "116"]);

export function toSecId(item: Pick<StockConfigItem, "market" | "code">): string {
  return `${item.market}.${item.code}`;
}

export function parseSecId(secId: string): { market: string; code: string } | null {
  const [market, code] = secId.split(".");
  if (!market || !code) {
    return null;
  }
  return { market, code };
}

export function isValidMarket(market: string): boolean {
  return VALID_MARKETS.has(market);
}

export function marketTag(secId: string): string {
  const parsed = parseSecId(secId);
  if (!parsed) {
    return "";
  }
  const { market, code } = parsed;
  if (market === "116") {
    return " ［港］";
  }
  if (["105", "106", "107"].includes(market)) {
    return " ［美］";
  }
  if (market === "0" && code.startsWith("3")) {
    return " ［创］";
  }
  if (market === "1" && code.startsWith("688")) {
    return " ［科］";
  }
  return "";
}

export function parseLegacyStockString(input: string): StockConfigItem | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":").map((part) => part.trim());
  if (parts.length < 1 || parts.length > 3) {
    return null;
  }

  const secId = parseSecId(parts[0]);
  if (!secId || !isValidMarket(secId.market)) {
    return null;
  }

  const result: StockConfigItem = {
    market: secId.market,
    code: secId.code,
  };

  if (parts[1] !== undefined && parts[1] !== "") {
    const shares = Number(parts[1]);
    if (!Number.isFinite(shares) || shares < 0 || !Number.isInteger(shares)) {
      return null;
    }
    if (shares > 0) {
      result.shares = shares;
    }
  }

  if (parts[2] !== undefined && parts[2] !== "") {
    const costPrice = Number(parts[2]);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return null;
    }
    if (costPrice > 0) {
      result.costPrice = costPrice;
    }
  }

  return result;
}

export function normalizeStockConfig(raw: unknown): StockConfigItem | null {
  if (!raw) {
    return null;
  }

  if (typeof raw === "string") {
    return parseLegacyStockString(raw);
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const market = String(obj.market ?? "").trim();
    const code = String(obj.code ?? "").trim();
    if (!market || !code || !isValidMarket(market)) {
      return null;
    }

    const result: StockConfigItem = { market, code };

    if (obj.shares !== undefined && obj.shares !== null && obj.shares !== "") {
      const shares = Number(obj.shares);
      if (!Number.isFinite(shares) || shares < 0 || !Number.isInteger(shares)) {
        return null;
      }
      if (shares > 0) {
        result.shares = shares;
      }
    }

    if (
      obj.costPrice !== undefined &&
      obj.costPrice !== null &&
      obj.costPrice !== ""
    ) {
      const costPrice = Number(obj.costPrice);
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        return null;
      }
      if (costPrice > 0) {
        result.costPrice = costPrice;
      }
    }

    return result;
  }

  return null;
}

export function toHoldingMap(items: StockConfigItem[]): Map<string, HoldingInfo> {
  const map = new Map<string, HoldingInfo>();
  for (const item of items) {
    if (item.shares && item.shares > 0) {
      map.set(toSecId(item), {
        shares: item.shares,
        costPrice: item.costPrice,
      });
    }
  }
  return map;
}
