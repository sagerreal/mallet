/**
 * eslint-rules/index.mjs
 * Local ESLint plugin that locks the design-system invariants so they can't drift
 * back (see docs/design-system.md). Lands in WARN; flips to error in P7.
 *
 *   ui/no-raw-style  — spacing/type/radius style values must be design tokens.
 *   ui/no-adhoc-card — a border+radius+background style triple should be <Card>.
 *   ui/no-bare-field — an inline-styled raw <input>/<select>/<textarea> should
 *                      use the Field primitive / .field container.
 */

// Style props governed by the token scale (space / type / radius).
const TOKEN_PROPS = new Set([
  "fontSize",
  "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "gap", "rowGap", "columnGap",
  "borderRadius",
]);

const RAW_PX = /(?:^|[\s,])\d+(?:\.\d+)?px/;

function keyName(prop) {
  if (prop.type !== "Property" || prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return null;
}

/** True when a value node is a raw (non-tokenised) px/number, not var()/0/auto/%.
 *  `key` is the style property — asymmetric (multi-value) borderRadius shorthands
 *  like "0 0 8px 8px" or "18px 18px 4px 18px" (chat bubbles, dropdown corners) are
 *  a legitimate per-corner design, not a magic number, so they're not flagged. */
function isRawValue(node, key) {
  if (!node || node.type !== "Literal") return false;
  if (typeof node.value === "number") return node.value !== 0;
  if (typeof node.value === "string") {
    const v = node.value;
    if (v.includes("var(") || v.includes("calc(") || v.includes("env(")) return false;
    if (key === "borderRadius" && v.trim().includes(" ")) return false; // asymmetric corners
    return RAW_PX.test(v);
  }
  return false;
}

const noRawStyle = {
  meta: {
    type: "problem",
    docs: { description: "Spacing/type/radius style values must use design tokens (var(--…)), not raw px." },
    schema: [],
    messages: { raw: "Use a design token for '{{prop}}' — var(--…), not the raw value `{{value}}`." },
  },
  create(context) {
    return {
      "JSXAttribute[name.name='style'] JSXExpressionContainer > ObjectExpression"(node) {
        for (const p of node.properties) {
          const key = keyName(p);
          if (!key || !TOKEN_PROPS.has(key)) continue;
          if (isRawValue(p.value, key)) {
            const raw = p.value.value;
            context.report({ node: p.value, messageId: "raw", data: { prop: key, value: String(raw) } });
          }
        }
      },
    };
  },
};

const noAdhocCard = {
  meta: {
    type: "suggestion",
    docs: { description: "A border+radius+background style triple is an ad-hoc card — use the <Card> primitive." },
    schema: [],
    messages: { card: "This border+radius+background style is an ad-hoc card — use <Card> (components/ui/card)." },
  },
  create(context) {
    return {
      "JSXAttribute[name.name='style'] JSXExpressionContainer > ObjectExpression"(node) {
        const keys = new Set(node.properties.map(keyName).filter(Boolean));
        const hasBorder = keys.has("border") || keys.has("borderWidth") || keys.has("borderColor");
        if (hasBorder && keys.has("borderRadius") && keys.has("background")) {
          context.report({ node, messageId: "card" });
        }
      },
    };
  },
};

const noBareField = {
  meta: {
    type: "suggestion",
    docs: { description: "An inline-styled raw form control should use the Field primitive / .field container." },
    schema: [],
    messages: { field: "Inline-styled <{{tag}}> — use the Field primitive or a .field container so it inherits the field styles." },
  },
  create(context) {
    const TAGS = new Set(["input", "select", "textarea"]);
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !TAGS.has(node.name.name)) return;
        const hasStyle = node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "style",
        );
        if (hasStyle) {
          context.report({ node, messageId: "field", data: { tag: node.name.name } });
        }
      },
    };
  },
};

export default {
  rules: {
    "no-raw-style": noRawStyle,
    "no-adhoc-card": noAdhocCard,
    "no-bare-field": noBareField,
  },
};
