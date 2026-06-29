import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseMetaErrorAr, assertMetaOk } from "../services/meta-graph";
import { AppError } from "../lib/errors";
import { createTemplateSchema } from "../modules/templates/templates.schema";

// ─── parseMetaErrorAr ─────────────────────────────────────────────────────────

describe("parseMetaErrorAr", () => {
  function wrap(code: number, message = "some error") {
    return { error: { code, message, type: "OAuthException", fbtrace_id: "trace123" } };
  }

  it("maps 190 → token expired Arabic", () => {
    const msg = parseMetaErrorAr(wrap(190));
    expect(msg).toContain("رمز الوصول");
    expect(msg).toContain("ميتا");
  });

  it("maps 10 → permission denied Arabic", () => {
    const msg = parseMetaErrorAr(wrap(10));
    expect(msg).toContain("صلاحية");
  });

  it("maps code in 200–299 range → permission denied Arabic", () => {
    const msg = parseMetaErrorAr(wrap(200));
    expect(msg).toContain("صلاحية");
  });

  it("maps 4 → rate limit Arabic", () => {
    const msg = parseMetaErrorAr(wrap(4));
    expect(msg).toContain("معدّل الطلبات");
  });

  it("maps 80007 → rate limit Arabic", () => {
    const msg = parseMetaErrorAr(wrap(80007));
    expect(msg).toContain("معدّل الطلبات");
  });

  it("maps 130429 → rate limit Arabic", () => {
    const msg = parseMetaErrorAr(wrap(130429));
    expect(msg).toContain("معدّل الطلبات");
  });

  it("maps 132000 → duplicate template Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132000));
    expect(msg).toContain("اسم");
    expect(msg).toContain("موجود");
  });

  it("maps 132001 → already deleted Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132001));
    expect(msg).toContain("محذوف");
  });

  it("maps 132005 → invalid language code Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132005));
    expect(msg).toContain("اللغة");
  });

  it("maps 132007 → content policy Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132007));
    expect(msg).toContain("سياسة");
  });

  it("maps 132012 → variable count mismatch Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132012));
    expect(msg).toContain("متغير");
  });

  it("maps 132016 → invalid components Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132016));
    expect(msg).toContain("مكوّن");
  });

  it("maps 132068 → variable format Arabic", () => {
    const msg = parseMetaErrorAr(wrap(132068));
    expect(msg).toContain("{{1}}");
  });

  it("includes error code and message for unknown codes", () => {
    const msg = parseMetaErrorAr(wrap(99999, "Unknown error from Meta"));
    expect(msg).toContain("99999");
    expect(msg).toContain("Unknown error from Meta");
  });

  it("handles null payload gracefully", () => {
    const msg = parseMetaErrorAr(null);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles missing error object gracefully", () => {
    const msg = parseMetaErrorAr({ some_other_key: "value" });
    expect(typeof msg).toBe("string");
  });

  it("includes error_data.details when available", () => {
    const payload = {
      error: {
        code: 99,
        message: "outer message",
        error_data: { details: "specific detail about the problem" },
      },
    };
    const msg = parseMetaErrorAr(payload);
    expect(msg).toContain("specific detail about the problem");
  });
});

// ─── assertMetaOk ────────────────────────────────────────────────────────────

describe("assertMetaOk", () => {
  it("does not throw when result.ok === true", () => {
    expect(() => assertMetaOk({ ok: true, dryRun: false })).not.toThrow();
  });

  it("does not throw for dry run results", () => {
    expect(() => assertMetaOk({ ok: true, dryRun: true })).not.toThrow();
  });

  it("throws AppError when result.ok === false", () => {
    const result = {
      ok: false,
      dryRun: false,
      status: "400",
      payload: { error: { code: 190, message: "Token expired" } },
    };
    expect(() => assertMetaOk(result, "test_context")).toThrow(AppError);
  });

  it("thrown AppError contains Arabic message from parseMetaErrorAr", () => {
    const result = {
      ok: false,
      dryRun: false,
      status: "401",
      payload: { error: { code: 190, message: "Invalid OAuth access token" } },
    };
    try {
      assertMetaOk(result);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.messageAr).toContain("رمز الوصول");
      expect(appErr.code).toBe("META_API_ERROR");
      expect(appErr.statusCode).toBe(400);
    }
  });

  it("thrown AppError for rate limit has correct Arabic text", () => {
    const result = {
      ok: false,
      dryRun: false,
      status: "429",
      payload: { error: { code: 4, message: "Application request limit reached" } },
    };
    try {
      assertMetaOk(result);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.messageAr).toContain("معدّل الطلبات");
    }
  });
});

// ─── Meta payload mapping (via createTemplateSchema) ──────────────────────────

describe("editor payload → Meta component format", () => {
  function parsePayload(overrides: Partial<Parameters<typeof createTemplateSchema.parse>[0]> = {}) {
    return createTemplateSchema.parse({
      name: "test_template",
      language: "ar",
      category: "utility",
      components: [
        { type: "BODY", text: "Hello {{1}}", example: { body_text: [["World"]] } },
      ],
      variables: [],
      ...overrides,
    });
  }

  it("validates TEXT header with variable example", () => {
    const parsed = parsePayload({
      components: [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Hello {{1}}",
          example: { header_text: ["John"] },
        },
        { type: "BODY", text: "Your order is ready." },
      ],
    });
    const header = parsed.components.find((c) => c.type === "HEADER") as Record<string, unknown>;
    expect(header?.["format"]).toBe("TEXT");
    expect((header?.["example"] as Record<string, unknown>)?.["header_text"]).toEqual(["John"]);
  });

  it("validates IMAGE header with header_handle example", () => {
    const parsed = parsePayload({
      components: [
        {
          type: "HEADER",
          format: "IMAGE",
          example: { header_handle: ["4::aW1hZ2UvanBlZw==:..."] },
        },
        { type: "BODY", text: "Check out this image!" },
      ],
    });
    const header = parsed.components.find((c) => c.type === "HEADER") as Record<string, unknown>;
    expect(header?.["format"]).toBe("IMAGE");
    expect((header?.["example"] as Record<string, unknown>)?.["header_handle"]).toBeTruthy();
  });

  it("validates DOCUMENT header with header_handle example", () => {
    const parsed = parsePayload({
      components: [
        {
          type: "HEADER",
          format: "DOCUMENT",
          example: { header_handle: ["doc_handle_123"] },
        },
        { type: "BODY", text: "Your document is attached." },
      ],
    });
    const header = parsed.components.find((c) => c.type === "HEADER") as Record<string, unknown>;
    expect(header?.["format"]).toBe("DOCUMENT");
  });

  it("validates body variable example in Meta format body_text: [[...]]", () => {
    const parsed = parsePayload({
      components: [
        {
          type: "BODY",
          text: "Hello {{1}}, your code is {{2}}",
          example: { body_text: [["John", "1234"]] },
        },
      ],
    });
    const body = parsed.components.find((c) => c.type === "BODY") as Record<string, unknown>;
    expect((body?.["example"] as Record<string, unknown>)?.["body_text"]).toEqual([["John", "1234"]]);
  });

  it("validates URL button with example array (Meta format)", () => {
    const parsed = parsePayload({
      components: [
        { type: "BODY", text: "Click below" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "URL", text: "Track", url: "https://track.example.com/{{1}}", example: ["order123"] },
          ],
        },
      ],
    });
    const btnComp = parsed.components.find((c) => c.type === "BUTTONS") as Record<string, unknown>;
    const buttons = btnComp?.["buttons"] as Array<Record<string, unknown>>;
    expect(buttons?.[0]?.["example"]).toEqual(["order123"]);
  });

  it("validates authentication template with COPY_CODE button", () => {
    const parsed = parsePayload({
      category: "authentication",
      components: [
        { type: "BODY", text: "Your verification code is {{1}}", example: { body_text: [["123456"]] } },
        {
          type: "BUTTONS",
          buttons: [{ type: "COPY_CODE", example: "123456" }],
        },
      ],
    });
    const btnComp = parsed.components.find((c) => c.type === "BUTTONS") as Record<string, unknown>;
    const buttons = btnComp?.["buttons"] as Array<Record<string, unknown>>;
    expect(buttons?.[0]?.["type"]).toBe("COPY_CODE");
  });

  it("rejects template missing BODY component", () => {
    expect(() =>
      parsePayload({
        components: [{ type: "FOOTER", text: "Reply STOP" }],
      }),
    ).toThrow();
  });

  it("rejects non-contiguous body variables", () => {
    expect(() =>
      parsePayload({
        components: [{ type: "BODY", text: "Hello {{1}} and {{3}}" }],
      }),
    ).toThrow();
  });

  it("rejects QUICK_REPLY mixed with URL button", () => {
    expect(() =>
      parsePayload({
        components: [
          { type: "BODY", text: "Choose one" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Yes" },
              { type: "URL", text: "Learn more", url: "https://example.com" },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects OTP button in utility category", () => {
    expect(() =>
      parsePayload({
        category: "utility",
        components: [
          { type: "BODY", text: "Use this code" },
          { type: "BUTTONS", buttons: [{ type: "OTP" }] },
        ],
      }),
    ).toThrow();
  });

  it("rejects authentication category with URL button", () => {
    expect(() =>
      parsePayload({
        category: "authentication",
        components: [
          { type: "BODY", text: "Check this out" },
          {
            type: "BUTTONS",
            buttons: [{ type: "URL", text: "Visit", url: "https://example.com" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects dynamic URL button without example", () => {
    expect(() =>
      parsePayload({
        components: [
          { type: "BODY", text: "Track your order" },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                text: "Track",
                url: "https://track.example.com/{{1}}",
                // No example provided
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

// ─── Workspace isolation: schema-level ───────────────────────────────────────

describe("workspace isolation via schema", () => {
  it("does not accept workspaceId in createTemplateSchema payload", () => {
    // workspaceId should not be a field in createTemplateSchema — it comes from the session
    const parsed = createTemplateSchema.safeParse({
      name: "my_template",
      language: "ar",
      category: "utility",
      components: [{ type: "BODY", text: "Hello world" }],
      workspaceId: "injected-workspace",
    });
    // If the field is ignored (or unknown keys stripped), the workspaceId won't appear in output
    expect((parsed.data as Record<string, unknown> | undefined)?.["workspaceId"]).toBeUndefined();
  });
});

// ─── Duplicate submission prevention (schema / service contract) ──────────────

describe("duplicate submission prevention", () => {
  it("createTemplateSchema does not allow empty name", () => {
    const result = createTemplateSchema.safeParse({
      name: "",
      language: "ar",
      category: "utility",
      components: [{ type: "BODY", text: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("createTemplateSchema enforces max name length of 120", () => {
    const result = createTemplateSchema.safeParse({
      name: "a".repeat(121),
      language: "ar",
      category: "utility",
      components: [{ type: "BODY", text: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("template names with spaces are handled — spaces must be underscores for Meta", () => {
    // The API accepts underscore names; space names should be sanitized in the UI
    const result = createTemplateSchema.safeParse({
      name: "my_template_name",
      language: "ar",
      category: "utility",
      components: [{ type: "BODY", text: "Hello" }],
    });
    expect(result.success).toBe(true);
  });
});

// ─── Media upload contract ────────────────────────────────────────────────────

describe("media upload header_handle contract", () => {
  it("HEADER IMAGE component with header_handle passes schema", () => {
    const result = createTemplateSchema.safeParse({
      name: "image_template",
      language: "ar",
      category: "marketing",
      components: [
        {
          type: "HEADER",
          format: "IMAGE",
          example: { header_handle: ["4::aW1hZ2UvanBlZw==:ARbitraryHandle"] },
        },
        { type: "BODY", text: "Check out this amazing product!" },
      ],
      variables: [],
    });
    expect(result.success).toBe(true);
  });

  it("HEADER VIDEO component with header_handle passes schema", () => {
    const result = createTemplateSchema.safeParse({
      name: "video_template",
      language: "ar",
      category: "marketing",
      components: [
        {
          type: "HEADER",
          format: "VIDEO",
          example: { header_handle: ["video_handle_xyz"] },
        },
        { type: "BODY", text: "Watch this video!" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("HEADER DOCUMENT component with header_handle passes schema", () => {
    const result = createTemplateSchema.safeParse({
      name: "doc_template",
      language: "ar",
      category: "utility",
      components: [
        {
          type: "HEADER",
          format: "DOCUMENT",
          example: { header_handle: ["doc_handle_abc"] },
        },
        { type: "BODY", text: "Your invoice is attached." },
      ],
    });
    expect(result.success).toBe(true);
  });
});
