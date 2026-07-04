import { describe, expect, it } from "vitest";
import { extractMetaCommerceMessage } from "../modules/integrations/meta-commerce-message";

describe("meta commerce message parsing", () => {
  it("parses WhatsApp catalog product replies into searchable text", () => {
    const result = extractMetaCommerceMessage({
      type: "interactive",
      interactive: {
        product_reply: {
          catalog_id: "catalog-123",
          product_retailer_id: "sku-987",
        },
      },
    }, "whatsapp");

    expect(result).toEqual({
      contentType: "interactive",
      content: "WhatsApp catalog product selected catalog_id=catalog-123: retailer_id=sku-987 product sku-987",
      attachments: [{
        type: "catalog_product",
        provider: "whatsapp",
        catalog_id: "catalog-123",
        product_retailer_id: "sku-987",
      }],
    });
  });

  it("parses WhatsApp catalog orders with product items", () => {
    const result = extractMetaCommerceMessage({
      type: "order",
      order: {
        catalog_id: "catalog-123",
        product_items: [
          {
            product_retailer_id: "sku-1",
            quantity: 2,
            item_price: "1250",
            currency: "YER",
          },
          {
            retailer_id: "sku-2",
          },
        ],
      },
    }, "meta");

    expect(result).toEqual({
      contentType: "order",
      content: "WhatsApp catalog order catalog_id=catalog-123: retailer_id=sku-1 product sku-1 quantity=2 price=1250 YER; retailer_id=sku-2 product sku-2",
      attachments: [{
        type: "catalog_order",
        provider: "meta",
        catalog_id: "catalog-123",
        product_items: [
          {
            product_retailer_id: "sku-1",
            quantity: 2,
            item_price: "1250",
            currency: "YER",
          },
          {
            retailer_id: "sku-2",
          },
        ],
      }],
    });
  });
});
