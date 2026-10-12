// Not a full draft-07 validator: only the keywords the vendored packaging schemas use.

const ANNOTATIONS = new Set([
  "$schema", "$id", "$comment", "title", "description", "default", "examples", "format", "definitions", "$defs",
]);

const KEYWORDS = new Set([
  "$ref", "type", "required", "properties", "additionalProperties", "patternProperties", "enum", "const",
  "pattern", "minLength", "maxLength", "minimum", "maximum", "items", "minItems", "maxItems", "uniqueItems",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
]);

export function checkSchema(doc, schema) {
  const errors = [];
  validate(doc, schema, "", schema, errors);
  return errors;
}

function pointerToken(key) {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function hasType(value, type) {
  const kind = kindOf(value);
  return kind === type || (type === "number" && kind === "integer");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split("/")) {
    const token = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!node || typeof node !== "object" || !Object.hasOwn(node, token)) return undefined;
    node = node[token];
  }
  return node;
}

const patternCache = new Map();
function compile(pattern) {
  if (!patternCache.has(pattern)) {
    let regex;
    try {
      regex = new RegExp(pattern, "u");
    } catch {
      // Some published patterns use escapes that only the non-unicode RegExp grammar accepts.
      regex = new RegExp(pattern);
    }
    patternCache.set(pattern, regex);
  }
  return patternCache.get(pattern);
}

function passes(value, schema, root) {
  const errors = [];
  validate(value, schema, "", root, errors);
  return errors.length === 0;
}

function validate(value, schema, ptr, root, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${ptr}: no value is allowed here`);
    return;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${ptr}: schema node is not an object or boolean`);
    return;
  }

  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) errors.push(`${ptr}: unsupported schema keyword "${key}"`);
  }

  if (schema.$ref !== undefined) {
    const target = resolveRef(schema.$ref, root);
    if (target === undefined) errors.push(`${ptr}: cannot resolve $ref ${schema.$ref}`);
    else validate(value, target, ptr, root, errors);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => hasType(value, type))) {
      errors.push(`${ptr}: expected type ${types.join(" or ")}, got ${kindOf(value)}`);
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((option) => canonical(option) === canonical(value))) {
    errors.push(`${ptr}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (Object.hasOwn(schema, "const") && canonical(schema.const) !== canonical(value)) {
    errors.push(`${ptr}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`${ptr}: length ${length} is below minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`${ptr}: length ${length} is above maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !compile(schema.pattern).test(value)) {
      errors.push(`${ptr}: ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${ptr}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${ptr}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${ptr}: ${value.length} items is below minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${ptr}: ${value.length} items is above maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Map();
      value.forEach((item, index) => {
        const key = canonical(item);
        if (seen.has(key)) errors.push(`${ptr}/${index}: duplicates item ${seen.get(key)} under uniqueItems`);
        else seen.set(key, index);
      });
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validate(item, schema.items, `${ptr}/${index}`, root, errors));
    }
  }

  if (kindOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${ptr}/${pointerToken(key)}: required property is missing`);
    }
    const properties = schema.properties ?? {};
    const patterns = Object.entries(schema.patternProperties ?? {});
    for (const [key, child] of Object.entries(value)) {
      const childPtr = `${ptr}/${pointerToken(key)}`;
      let matched = false;
      if (Object.hasOwn(properties, key)) {
        matched = true;
        validate(child, properties[key], childPtr, root, errors);
      }
      for (const [pattern, sub] of patterns) {
        if (compile(pattern).test(key)) {
          matched = true;
          validate(child, sub, childPtr, root, errors);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${childPtr}: additional property is not allowed`);
        else validate(child, schema.additionalProperties, childPtr, root, errors);
      }
    }
  }

  for (const sub of schema.allOf ?? []) validate(value, sub, ptr, root, errors);
  if (schema.anyOf !== undefined && !schema.anyOf.some((sub) => passes(value, sub, root))) {
    errors.push(`${ptr}: matches none of the anyOf branches`);
  }
  if (schema.oneOf !== undefined) {
    const count = schema.oneOf.filter((sub) => passes(value, sub, root)).length;
    if (count !== 1) errors.push(`${ptr}: matches ${count} of the oneOf branches, expected exactly 1`);
  }
  if (schema.not !== undefined && passes(value, schema.not, root)) {
    errors.push(`${ptr}: matches the schema under not`);
  }
  if (schema.if !== undefined) {
    const branch = passes(value, schema.if, root) ? schema.then : schema.else;
    if (branch !== undefined) validate(value, branch, ptr, root, errors);
  }
}
