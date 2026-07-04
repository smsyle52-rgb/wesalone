export type MetaCommerceMessageResult = {
  contentType: string;
  content: string;
  attachments: Record<string, unknown>[];
};

type MetaCommerceItem = {
  product_retailer_id?: string;
  retailer_id?: string;
  quantity?: string | number;
  item_price?: string | number;
  currency?: string;
};

function commerceItemLabel(item: MetaCommerceItem): string {
  const retailerId = item.product_retailer_id ?? item.retailer_id ?? "unknown";
  const quantity = item.quantity !== undefined ? ` quantity=${item.quantity}` : "";
  const price = item.item_price !== undefined
    ? ` price=${item.item_price}${item.currency ? ` ${item.currency}` : ""}`
    : "";
  return `retailer_id=${retailerId} product ${retailerId}${quantity}${price}`;
}

export function extractMetaCommerceMessage(
  message: Record<string, unknown> | null | undefined,
  provider: "meta" | "whatsapp",
): MetaCommerceMessageResult | null {
  if (message?.type === "order") {
    const order = message.order && typeof message.order === "object" && !Array.isArray(message.order)
      ? message.order as Record<string, unknown>
      : {};
    const catalogId = typeof order.catalog_id === "string" ? order.catalog_id : undefined;
    const items = Array.isArray(order.product_items)
      ? order.product_items.filter((item): item is MetaCommerceItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    const itemSummary = items.length > 0 ? items.map(commerceItemLabel).join("; ") : "no product_items";
    return {
      contentType: "order",
      content: `WhatsApp catalog order${catalogId ? ` catalog_id=${catalogId}` : ""}: ${itemSummary}`,
      attachments: [{
        type: "catalog_order",
        provider,
        catalog_id: catalogId ?? null,
        product_items: items,
      }],
    };
  }

  if (message?.type === "interactive") {
    const interactive = message.interactive && typeof message.interactive === "object" && !Array.isArray(message.interactive)
      ? message.interactive as Record<string, unknown>
      : {};
    const productReply = interactive.product_reply && typeof interactive.product_reply === "object" && !Array.isArray(interactive.product_reply)
      ? interactive.product_reply as Record<string, unknown>
      : null;
    if (!productReply) return null;
    const catalogId = typeof productReply.catalog_id === "string" ? productReply.catalog_id : undefined;
    const retailerId = typeof productReply.product_retailer_id === "string"
      ? productReply.product_retailer_id
      : typeof productReply.retailer_id === "string"
        ? productReply.retailer_id
        : "unknown";
    return {
      contentType: "interactive",
      content: `WhatsApp catalog product selected${catalogId ? ` catalog_id=${catalogId}` : ""}: retailer_id=${retailerId} product ${retailerId}`,
      attachments: [{
        type: "catalog_product",
        provider,
        catalog_id: catalogId ?? null,
        product_retailer_id: retailerId,
      }],
    };
  }

  return null;
}
