/**
 * Code Connect IR (Intermediate Representation) Extractor
 * 
 * Parses .figma.tsx and .figma.ts files using @typescript-eslint/typescript-estree
 * and extracts a normalized IR for validation and analysis.
 * 
 * The IR captures:
 * - Import declarations
 * - figma.connect() call structure and arguments
 * - props object with helper calls (figma.string, figma.enum, etc.)
 * - example function signature and body
 * - prop references within example (props.foo)
 */

const { parse } = require('@typescript-eslint/typescript-estree');

/**
 * Parse Code Connect file and extract IR.
 * Hard-fails on parse errors with line and column information.
 * 
 * @param {string} code - The .figma.tsx or .figma.ts file content
 * @param {string} [filename='code-connect.tsx'] - Filename for error messages
 * @returns {object} IR object with parsed structure
 * @throws {Error} Parse error with line/column information
 */
function extractIR(code, filename = 'code-connect.tsx') {
  let ast;
  
  try {
    ast = parse(code, {
      loc: true,
      range: true,
      comment: false,
      jsx: true,
      errorOnUnknownASTType: true,
      filePath: filename
    });
  } catch (err) {
    // Enhance error with precise location
    const message = err.message || String(err);
    const lineMatch = message.match(/line (\d+)/i);
    const line = lineMatch ? lineMatch[1] : err.lineNumber || err.line || '?';
    const column = err.column || '?';
    
    throw new Error(`Parse error in ${filename}:${line}:${column}: ${message}`);
  }

  const ir = {
    imports: [],
    connects: []
  };

  // Extract imports
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      ir.imports.push(extractImport(node));
    }
  }

  // Extract figma.connect calls
  walkAST(ast, (node) => {
    if (isFigmaConnectCall(node)) {
      ir.connects.push(extractConnect(node, code));
    }
  });

  return ir;
}

/**
 * Extract import declaration info
 */
function extractImport(node) {
  return {
    source: node.source.value,
    specifiers: node.specifiers.map(spec => {
      if (spec.type === 'ImportDefaultSpecifier') {
        return { type: 'default', name: spec.local.name };
      } else if (spec.type === 'ImportSpecifier') {
        return { 
          type: 'named', 
          name: spec.imported.name,
          alias: spec.local.name !== spec.imported.name ? spec.local.name : null
        };
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        return { type: 'namespace', name: spec.local.name };
      }
      return { type: 'unknown', name: spec.local?.name };
    })
  };
}

/**
 * Check if node is a figma.connect() call
 */
function isFigmaConnectCall(node) {
  return node.type === 'CallExpression' &&
         node.callee.type === 'MemberExpression' &&
         node.callee.object.type === 'Identifier' &&
         node.callee.object.name === 'figma' &&
         node.callee.property.type === 'Identifier' &&
         node.callee.property.name === 'connect';
}

/**
 * Extract figma.connect() call structure
 */
function extractConnect(callNode, sourceCode) {
  const args = callNode.arguments;
  
  const connect = {
    loc: callNode.loc,
    kind: null,  // 'component' or 'url-only'
    component: null,
    url: null,
    config: null
  };

  // Determine kind and extract arguments
  if (args.length === 2) {
    // figma.connect(Component, 'url', config) or figma.connect('url', config)
    const firstArg = args[0];
    if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
      // URL-only form: figma.connect('url', config)
      connect.kind = 'url-only';
      connect.url = {
        value: firstArg.value,
        loc: firstArg.loc,
        isLiteral: true
      };
    } else {
      // Component form: figma.connect(Component, 'url')
      // This is actually invalid - needs 3 args for component form
      connect.kind = 'invalid';
    }
    
    // Second arg is config
    connect.config = extractConfig(args[1], sourceCode);
    
  } else if (args.length === 3) {
    // Component form: figma.connect(Component, 'url', config)
    connect.kind = 'component';
    
    const componentArg = args[0];
    connect.component = {
      name: componentArg.type === 'Identifier' ? componentArg.name : null,
      type: componentArg.type,
      loc: componentArg.loc
    };
    
    const urlArg = args[1];
    connect.url = {
      value: urlArg.type === 'Literal' ? urlArg.value : null,
      loc: urlArg.loc,
      isLiteral: urlArg.type === 'Literal'
    };
    
    connect.config = extractConfig(args[2], sourceCode);
    
  } else {
    connect.kind = 'invalid';
  }

  return connect;
}

/**
 * Extract config object structure
 */
function extractConfig(configNode, sourceCode) {
  if (!configNode || configNode.type !== 'ObjectExpression') {
    return {
      isObjectLiteral: false,
      props: null,
      example: null,
      variant: null,
      loc: configNode?.loc
    };
  }

  const config = {
    isObjectLiteral: true,
    props: null,
    example: null,
    variant: null,
    loc: configNode.loc
  };

  for (const prop of configNode.properties) {
    if (prop.type !== 'Property') continue;
    
    const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    
    if (key === 'props') {
      config.props = extractPropsObject(prop.value);
    } else if (key === 'example') {
      config.example = extractExampleFunction(prop.value, sourceCode);
    } else if (key === 'variant') {
      config.variant = extractVariant(prop.value);
    }
  }

  return config;
}

/**
 * Extract props object with figma helper calls
 */
function extractPropsObject(propsNode) {
  if (!propsNode || propsNode.type !== 'ObjectExpression') {
    return {
      isObjectLiteral: false,
      helpers: [],
      loc: propsNode?.loc
    };
  }

  const helpers = [];

  for (const prop of propsNode.properties) {
    if (prop.type !== 'Property') continue;
    
    const propName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    const helper = extractFigmaHelper(prop.value, propName);
    
    if (helper) {
      helpers.push(helper);
    }
  }

  return {
    isObjectLiteral: true,
    helpers,
    loc: propsNode.loc
  };
}

/**
 * Extract figma helper call (figma.string, figma.enum, etc.)
 */
function extractFigmaHelper(node, propName) {
  if (node.type !== 'CallExpression') return null;
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.object.type !== 'Identifier' || node.callee.object.name !== 'figma') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const helperName = node.callee.property.name;
  const args = node.arguments;
  
  const helper = {
    propName,
    helper: helperName,
    key: null,
    keyLiteral: null,
    enumMapping: null,
    loc: node.loc
  };

  // Extract key (first argument)
  if (args.length > 0 && args[0].type === 'Literal') {
    helper.key = args[0].value;
    helper.keyLiteral = true;
  } else if (args.length > 0) {
    helper.keyLiteral = false;
  }

  // For figma.enum, extract the mapping object
  if (helperName === 'enum' && args.length > 1) {
    helper.enumMapping = extractEnumMapping(args[1]);
  }

  return helper;
}

/**
 * Extract enum mapping object {FigmaValue: 'codeValue', ...}
 */
function extractEnumMapping(node) {
  if (node.type !== 'ObjectExpression') {
    return { isObjectLiteral: false, mappings: [] };
  }

  const mappings = [];
  
  for (const prop of node.properties) {
    if (prop.type !== 'Property') continue;
    
    const figmaValue = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    const codeValue = prop.value.type === 'Literal' ? prop.value.value : null;
    
    mappings.push({
      figmaValue,
      codeValue,
      codeValueIsLiteral: prop.value.type === 'Literal'
    });
  }

  return { isObjectLiteral: true, mappings };
}

/**
 * Extract example function
 */
function extractExampleFunction(node, sourceCode) {
  if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') {
    return {
      isFunction: false,
      loc: node?.loc
    };
  }

  const example = {
    isFunction: true,
    isArrowFunction: node.type === 'ArrowFunctionExpression',
    params: node.params.map(p => p.name || p.type),
    hasBlock: node.body.type === 'BlockStatement',
    propsReferences: [],
    forbiddenExpressions: [],
    loc: node.loc,
    bodyLoc: node.body.loc
  };

  // Check if it's a direct return (arrow function without block)
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
    example.hasBlock = false;
    example.directReturn = true;
  }

  // Extract props references and check for forbidden expressions
  walkAST(node.body, (childNode) => {
    // Check for props.xyz references
    if (childNode.type === 'MemberExpression' &&
        childNode.object.type === 'Identifier' &&
        childNode.object.name === 'props' &&
        childNode.property.type === 'Identifier') {
      example.propsReferences.push({
        name: childNode.property.name,
        loc: childNode.loc
      });
    }

    // Check for forbidden expressions
    const forbidden = checkForbiddenExpression(childNode);
    if (forbidden) {
      example.forbiddenExpressions.push(forbidden);
    }
  });

  return example;
}

/**
 * Extract variant property
 */
function extractVariant(node) {
  if (!node || node.type !== 'ObjectExpression') {
    return { isObjectLiteral: false, restrictions: {} };
  }

  // Extract variant restrictions: { Type: 'Primary', Size: 'Large' }
  const restrictions = {};
  
  for (const prop of node.properties) {
    if (prop.type !== 'Property') continue;
    
    const key = prop.key.type === 'Identifier' 
      ? prop.key.name 
      : (prop.key.type === 'Literal' ? prop.key.value : null);
    
    if (key === null) continue;
    
    const value = prop.value.type === 'Literal' ? prop.value.value : null;
    restrictions[key] = value;
  }

  return { isObjectLiteral: true, restrictions, loc: node.loc };
}

/**
 * Check for forbidden expressions in example
 */
function checkForbiddenExpression(node) {
  const forbidden = {
    type: null,
    operator: null,
    loc: node.loc
  };

  // Ternary/conditional expression: a ? b : c
  if (node.type === 'ConditionalExpression') {
    forbidden.type = 'ternary';
    return forbidden;
  }

  // Logical expressions: && ||
  if (node.type === 'LogicalExpression') {
    forbidden.type = 'logical';
    forbidden.operator = node.operator;
    return forbidden;
  }

  // Binary expressions (comparisons, arithmetic, etc.)
  if (node.type === 'BinaryExpression') {
    forbidden.type = 'binary';
    forbidden.operator = node.operator;
    return forbidden;
  }

  // Prefix unary operators used for conditional logic: ! ~ + - typeof void delete
  if (node.type === 'UnaryExpression' && !node.prefix === false) {
    // Allow postfix operators like i++
    // Disallow prefix operators that are typically used for conditionals
    const conditionalOps = ['!', '~', 'typeof', 'void', 'delete'];
    if (conditionalOps.includes(node.operator)) {
      forbidden.type = 'unary';
      forbidden.operator = node.operator;
      return forbidden;
    }
  }

  // Nested template literals (TemplateLiteral inside TemplateLiteral)
  if (node.type === 'TemplateLiteral') {
    // Check if parent is also a TemplateLiteral or TemplateElement
    // This is tricky without parent tracking, we'll handle this in the walker
  }

  return null;
}

/**
 * Walk AST and call visitor for each node
 */
function walkAST(node, visitor) {
  if (!node || typeof node !== 'object') return;
  
  visitor(node);
  
  for (const key in node) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    
    const child = node[key];
    
    if (Array.isArray(child)) {
      for (const item of child) {
        walkAST(item, visitor);
      }
    } else if (child && typeof child === 'object') {
      walkAST(child, visitor);
    }
  }
}

module.exports = {
  extractIR
};
