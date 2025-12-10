const normalizeType = (value) => (value ? String(value).toLowerCase() : '');
const ARRAY_LIKE_INPUTS = new Set(['options', 'items', 'choices']);
const defaultArrayItems = { label: { type: 'string' }, value: { type: 'string' } };

const escapeRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const normalizeInputs = (rawInputs) => {
  const inputs = rawInputs && typeof rawInputs === 'object' ? rawInputs : {};
  return Object.entries(inputs).reduce((acc, [name, def = {}]) => {
    const type = normalizeType(def.type);
    const needsArray = type !== 'array' && ARRAY_LIKE_INPUTS.has(name.toLowerCase());
    if (type === 'array' || needsArray) {
      acc[name] = {
        ...def,
        type: 'string',
        _isArray: true,
        items:
          def.items && typeof def.items === 'object' && !Array.isArray(def.items)
            ? def.items
            : defaultArrayItems
      };
      return acc;
    }
    acc[name] = { ...def, type, _isArray: false };
    return acc;
  }, {});
};

const buildScalarControl = (propName, def = {}) => {
  const type = normalizeType(def.type);
  if (type === 'enum' && Array.isArray(def.values)) {
    const mapped = def.values.reduce((obj, val) => {
      obj[val] = val;
      return obj;
    }, {});
    return `figma.enum('${propName}', ${JSON.stringify(mapped)})`;
  }
  if (type === 'boolean') {
    return `figma.boolean('${propName}')`;
  }
  if (type === 'number') {
    return `figma.string('${propName}')`;
  }
  return `figma.string('${propName}')`;
};

const buildControl = (propName, def = {}) => {
  if (def._isArray) {
    return `    ${propName}: figma.string('${propName}')`;
  }
  return `    ${propName}: ${buildScalarControl(propName, def)}`;
};

const buildArrayLiteral = (def = {}) => {
  const items = def.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    const keys = Object.keys(items);
    const pairs = (keys.length ? keys : ['value']).slice(0, 3).map((key) => `${key}: '${key}'`);
    return `[ { ${pairs.join(', ')} } ]`;
  }
  return "['item']";
};

const normalizeBooleanBindings = (template, inputs) => {
  if (!template) return template;
  let result = template;
  Object.keys(inputs || {}).forEach((name) => {
    const escaped = escapeRegExp(name);
    const twoWay = new RegExp(`\\[\\(${escaped}\\)\\]\\s*=\\s*"([^"]*)"`, 'gi');
    const twoWaySingle = new RegExp(`\\[\\(${escaped}\\)\\]\\s*=\\s*'([^']*)'`, 'gi');
    const replaceTwoWay = (match, value) => {
      const cleaned = String(value).trim().replace(/^['"]|['"]$/g, '');
      const lower = cleaned.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        return `[${name}]="${lower}"`;
      }
      return `[${name}]="true"`;
    };
    result = result.replace(twoWay, replaceTwoWay).replace(twoWaySingle, replaceTwoWay);
  });

  Object.entries(inputs || {}).forEach(([name, def = {}]) => {
    if (normalizeType(def.type) !== 'boolean') return;
    const escaped = escapeRegExp(name);
    const doubleQuoted = new RegExp(`\\[${escaped}\\]\\s*=\\s*"([^"]*)"`, 'gi');
    const singleQuoted = new RegExp(`\\[${escaped}\\]\\s*=\\s*'([^']*)'`, 'gi');
    const replaceBinding = (match, value) => {
      const cleaned = String(value).trim().replace(/^['"]|['"]$/g, '');
      const lower = cleaned.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        return `[${name}]="${lower}"`;
      }
      return match;
    };
    result = result.replace(doubleQuoted, replaceBinding).replace(singleQuoted, replaceBinding);
  });
  return result;
};

const normalizeStaticStringBindings = (template, inputs) => {
  if (!template) return template;
  let result = template;
  const shouldSimplify = (def = {}) => {
    const type = normalizeType(def.type);
    if (def._isArray) return false;
    if (type === 'boolean' || type === 'number') return false;
    return true;
  };
  Object.entries(inputs || {}).forEach(([name, def = {}]) => {
    if (!shouldSimplify(def)) return;
    const escaped = escapeRegExp(name);
    const doubleQuoted = new RegExp(`\\[${escaped}\\]\\s*=\\s*"([^"]*)"`, 'gi');
    const singleQuoted = new RegExp(`\\[${escaped}\\]\\s*=\\s*'([^']*)'`, 'gi');
    const replaceBinding = (match, value) => {
      const cleaned = String(value).trim().replace(/^['"]|['"]$/g, '');
      if (!cleaned) return match;
      return `${name}="${cleaned}"`;
    };
    result = result.replace(doubleQuoted, replaceBinding).replace(singleQuoted, replaceBinding);
  });
  return result;
};

const toEventHandlerName = (eventName) => {
  const parts = String(eventName || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));
  const suffix = parts.length ? parts.join('') : 'Event';
  return `handle${suffix}`;
};

const normalizeEventBindings = (template) => {
  if (!template) return template;
  const replaceEvent = (match, evt) => `(${evt})="${toEventHandlerName(evt)}()"`;
  const doubleQuoted = /\(\s*([a-zA-Z0-9_-]+)\s*\)\s*=\s*"[^"]*"/g;
  const singleQuoted = /\(\s*([a-zA-Z0-9_-]+)\s*\)\s*=\s*'[^']*'/g;
  return template.replace(doubleQuoted, replaceEvent).replace(singleQuoted, replaceEvent);
};

const resolveExampleTemplate = (userTemplate, selector, inputs) => {
  const cleaned = normalizeEventBindings(userTemplate && String(userTemplate).trim());
  const normalizedTemplate = normalizeBooleanBindings(cleaned, inputs);
  if (normalizedTemplate) {
    return normalizeStaticStringBindings(normalizedTemplate, inputs);
  }
  const arrayEntry =
    inputs &&
    Object.entries(inputs).find(([, def = {}]) => def && def._isArray);
  if (arrayEntry) {
    const [name, def] = arrayEntry;
    return `<${selector} [${name}]="${buildArrayLiteral(def)}"></${selector}>`;
  }
  return `<${selector}></${selector}>`;
};

const renderAngularFromSchema = (
  schema,
  figmaUrl,
  angularSelectorFallback = 'component',
  figmaComponentProperties = null
) => {
  const selector = schema.selector || angularSelectorFallback || 'component';
  const inputs = normalizeInputs(schema.inputs);
  const hasComponentProps = Array.isArray(figmaComponentProperties);
  const allowedKeys = hasComponentProps
    ? new Set(figmaComponentProperties.map((p) => p?.name).filter(Boolean))
    : null;
  const filteredInputs = !hasComponentProps
    ? {}
    : allowedKeys && allowedKeys.size === 0
      ? {}
      : Object.fromEntries(Object.entries(inputs).filter(([name]) => allowedKeys.has(name)));

  const propLines = Object.entries(filteredInputs).map(([name, def = {}]) => buildControl(name, def));
  const propsBlock = propLines.length ? ['  props: {', ...propLines.map((l) => `${l},`), '  },'] : ['  props: {},'];
  const exampleInputs = Object.keys(filteredInputs).length ? filteredInputs : inputs;
  const exampleTemplate = resolveExampleTemplate(schema.example_template, selector, exampleInputs);

  const lines = [];
  lines.push("import figma from '@figma/code-connect';");
  lines.push("import { html } from 'lit-html';");
  lines.push('');
  lines.push(`figma.connect('${figmaUrl}', {`);
  propsBlock.forEach((l) => lines.push(l));
  lines.push(`  example: (props) => html\`${exampleTemplate}\``);
  lines.push('});');
  lines.push('');
  return lines.join('\n');
};

module.exports = {
  renderAngularFromSchema,
  normalizeBooleanBindings,
  normalizeStaticStringBindings,
  resolveExampleTemplate,
  normalizeInputs,
  buildArrayLiteral
};
