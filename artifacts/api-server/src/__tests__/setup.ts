// Mock @workspace/db so unit tests can import services without a real DB connection
import { vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  pointWalletsTable: {},
  pointGrantsTable: {},
  pointLedgerTable: {},
  pointTopupProductsTable: {},
  pointPurchaseOrdersTable: {},
  plansTable: {},
  subscriptionsTable: {},
}));
