import { StockData } from "../../models/stock";

export type QuoteErrorType = "unsupported_symbol" | "network_error" | "parse_error";

export interface QuoteErrorInfo {
  type: QuoteErrorType;
  provider: string;
  message: string;
}

export interface BatchFetchResult {
  data: Map<string, StockData>;
  errors: Map<string, QuoteErrorInfo>;
}

export interface MarketDataProvider {
  fetch(keys: string[], updateTime: string): Promise<BatchFetchResult>;
}
