import { StockData } from "../../models/stock";

export interface ApiResultItem {
  key: string;
  data: StockData;
}

export interface MarketDataProvider {
  fetch(keys: string[], updateTime: string): Promise<Map<string, StockData>>;
}
