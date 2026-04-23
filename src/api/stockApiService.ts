import { EastMoneyStockProvider } from "./providers/eastMoneyStockProvider";
import { SinaIndexFutureProvider } from "./providers/sinaIndexFutureProvider";
import { TonghuashunSectorProvider } from "./providers/tonghuashunSectorProvider";
import { BatchFetchResult } from "./providers/types";

export class StockApiService {
  private readonly stockProvider = new EastMoneyStockProvider();
  private readonly sectorProvider = new TonghuashunSectorProvider();
  private readonly indexFutureProvider = new SinaIndexFutureProvider();

  async fetchBatchStocks(stockCodeList: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.stockProvider.fetch(stockCodeList, updateTime);
  }

  async fetchBatchSectors(sectorCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.sectorProvider.fetch(sectorCodes, updateTime);
  }

  async fetchBatchIndices(indexCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.indexFutureProvider.fetchIndices(indexCodes, updateTime);
  }

  async fetchBatchFutures(futureCodes: string[], updateTime: string): Promise<BatchFetchResult> {
    return this.indexFutureProvider.fetchFutures(futureCodes, updateTime);
  }
}
