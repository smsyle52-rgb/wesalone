import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const pointWalletRelations = defineRelationsPart(schema, (r) => ({
  pointWalletModel: {
    user: r.one.userModel({
      from: r.pointWalletModel.userId,
      to: r.userModel.id,
    }),
    grants: r.many.pointGrantModel({
      from: r.pointWalletModel.id,
      to: r.pointGrantModel.walletId,
    }),
    ledgerEntries: r.many.pointLedgerModel({
      from: r.pointWalletModel.id,
      to: r.pointLedgerModel.walletId,
    }),
  },
}))

export const pointGrantRelations = defineRelationsPart(schema, (r) => ({
  pointGrantModel: {
    wallet: r.one.pointWalletModel({
      from: r.pointGrantModel.walletId,
      to: r.pointWalletModel.id,
    }),
    ledgerEntries: r.many.pointLedgerModel({
      from: r.pointGrantModel.id,
      to: r.pointLedgerModel.grantId,
    }),
  },
}))

export const pointLedgerRelations = defineRelationsPart(schema, (r) => ({
  pointLedgerModel: {
    wallet: r.one.pointWalletModel({
      from: r.pointLedgerModel.walletId,
      to: r.pointWalletModel.id,
    }),
    grant: r.one.pointGrantModel({
      from: r.pointLedgerModel.grantId,
      to: r.pointGrantModel.id,
    }),
  },
}))

export const pointTopupProductRelations = defineRelationsPart(schema, (r) => ({
  pointTopupProductModel: {
    orders: r.many.pointPurchaseOrderModel({
      from: r.pointTopupProductModel.id,
      to: r.pointPurchaseOrderModel.topupProductId,
    }),
  },
}))

export const pointPurchaseOrderRelations = defineRelationsPart(schema, (r) => ({
  pointPurchaseOrderModel: {
    user: r.one.userModel({
      from: r.pointPurchaseOrderModel.userId,
      to: r.userModel.id,
    }),
    topupProduct: r.one.pointTopupProductModel({
      from: r.pointPurchaseOrderModel.topupProductId,
      to: r.pointTopupProductModel.id,
    }),
    receiptFile: r.one.fileModel({
      from: r.pointPurchaseOrderModel.receiptFileId,
      to: r.fileModel.id,
    }),
    reviewer: r.one.userModel({
      from: r.pointPurchaseOrderModel.reviewedBy,
      to: r.userModel.id,
    }),
    creditedGrant: r.one.pointGrantModel({
      from: r.pointPurchaseOrderModel.creditedGrantId,
      to: r.pointGrantModel.id,
    }),
  },
}))
