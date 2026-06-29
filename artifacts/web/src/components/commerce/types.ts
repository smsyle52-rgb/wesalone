export type CommerceTab = "products" | "stock" | "movements" | "locations";

export type CommerceProduct = {
  id: string;
  name: string;
  variantCount: number;
  available: number;
  minimumPrice: string | null;
  maximumPrice: string | null;
  currency: string | null;
};

export type StockLocation = {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  isActive: boolean;
};

export type StockLevel = {
  id: string;
  productName: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  locationName: string;
  onHand: number;
  reserved: number;
  incoming: number;
  available: number;
  lowStockThreshold: number;
};

export type StockMovement = {
  id: string;
  productName: string;
  variantTitle: string;
  locationName: string;
  movementType: string;
  quantity: number;
  reason: string;
  correlationId: string;
  createdAt: string;
};
