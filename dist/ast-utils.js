"use strict";
// ============================================================================
// opspec AST Utilities — Shared TypeScript AST helpers
// ============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkTree = walkTree;
exports.findClassDeclarations = findClassDeclarations;
exports.getClassName = getClassName;
exports.getBaseClassName = getBaseClassName;
exports.getClassMethods = getClassMethods;
exports.getMethodName = getMethodName;
exports.getClassProperties = getClassProperties;
exports.detectStoredFields = detectStoredFields;
exports.methodBodyContains = methodBodyContains;
exports.getMethodBodyText = getMethodBodyText;
exports.findBlockchainCalls = findBlockchainCalls;
exports.findStateWrites = findStateWrites;
exports.findGuardChecks = findGuardChecks;
exports.hasMethodDecorator = hasMethodDecorator;
exports.isPublicMethod = isPublicMethod;
exports.createSourceFile = createSourceFile;
const ts = __importStar(require("typescript"));
/**
 * Walk all nodes in an AST tree depth-first.
 */
function walkTree(node, callback) {
    callback(node);
    ts.forEachChild(node, (child) => walkTree(child, callback));
}
/**
 * Find all class declarations in a source file.
 */
function findClassDeclarations(sourceFile) {
    const classes = [];
    walkTree(sourceFile, (node) => {
        if (ts.isClassDeclaration(node)) {
            classes.push(node);
        }
    });
    return classes;
}
/**
 * Get the class name, or '<anonymous>'.
 */
function getClassName(node) {
    return node.name?.text || '<anonymous>';
}
/**
 * Get the base class name.
 */
function getBaseClassName(node) {
    if (!node.heritageClauses)
        return undefined;
    for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            for (const type of clause.types) {
                return type.expression.getText();
            }
        }
    }
    return undefined;
}
/**
 * Get all method declarations from a class.
 */
function getClassMethods(classDecl) {
    const methods = [];
    for (const member of classDecl.members) {
        if (ts.isMethodDeclaration(member)) {
            methods.push(member);
        }
    }
    return methods;
}
/**
 * Get the method name as a string.
 */
function getMethodName(method) {
    if (ts.isIdentifier(method.name)) {
        return method.name.text;
    }
    return method.name.getText();
}
/**
 * Get all property declarations from a class.
 */
function getClassProperties(classDecl) {
    const props = [];
    for (const member of classDecl.members) {
        if (ts.isPropertyDeclaration(member)) {
            props.push(member);
        }
    }
    return props;
}
/**
 * Detect stored fields in a class (StoredU256, StoredAddress, StoredBoolean, etc.)
 */
function detectStoredFields(classDecl, sourceFile) {
    const stored = new Map(); // fieldName -> type
    const storedTypes = [
        'StoredU256',
        'StoredAddress',
        'StoredBoolean',
        'StoredString',
        'StoredMapU256',
        'AddressMemoryMap',
    ];
    for (const member of classDecl.members) {
        if (ts.isPropertyDeclaration(member)) {
            const name = member.name.getText(sourceFile);
            const typeText = member.type?.getText(sourceFile) || '';
            const initText = member.initializer?.getText(sourceFile) || '';
            for (const st of storedTypes) {
                if (typeText.includes(st) || initText.includes(`new ${st}`)) {
                    stored.set(name, st);
                    break;
                }
            }
        }
    }
    return stored;
}
/**
 * Check if a method body contains a text pattern.
 */
function methodBodyContains(method, pattern, sourceFile) {
    if (!method.body)
        return false;
    const bodyText = sourceFile ? method.body.getText(sourceFile) : method.body.getText();
    if (typeof pattern === 'string') {
        return bodyText.includes(pattern);
    }
    return pattern.test(bodyText);
}
/**
 * Get the body text of a method.
 */
function getMethodBodyText(method, sourceFile) {
    if (!method.body)
        return '';
    return sourceFile ? method.body.getText(sourceFile) : method.body.getText();
}
/**
 * Find all Blockchain.call() expressions in a method.
 */
function findBlockchainCalls(method, sourceFile) {
    const calls = [];
    if (!method.body)
        return calls;
    walkTree(method.body, (node) => {
        if (ts.isCallExpression(node)) {
            const exprText = node.expression.getText(sourceFile);
            if (exprText === 'Blockchain.call') {
                calls.push({ pos: node.getStart(), text: node.getText(sourceFile) });
            }
        }
    });
    return calls;
}
/**
 * Find all state writes (this.field.value = ...) in a method.
 */
function findStateWrites(method, sourceFile, storedFields) {
    const writes = [];
    if (!method.body)
        return writes;
    walkTree(method.body, (node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const leftText = node.left.getText(sourceFile);
            if (leftText.endsWith('.value')) {
                const fieldMatch = leftText.match(/this\.(\w+)\.value/);
                if (fieldMatch && storedFields.has(fieldMatch[1])) {
                    writes.push({ pos: node.getStart(), field: fieldMatch[1], text: leftText });
                }
            }
        }
        // Also catch .set() calls on stored maps
        if (ts.isCallExpression(node)) {
            const exprText = node.expression.getText(sourceFile);
            if (exprText.includes('this.') && exprText.endsWith('.set')) {
                const fieldMatch = exprText.match(/this\.(\w+)\.set/);
                if (fieldMatch && storedFields.has(fieldMatch[1])) {
                    writes.push({ pos: node.getStart(), field: fieldMatch[1], text: exprText });
                }
            }
        }
    });
    return writes;
}
/**
 * Find guard checks (if condition -> throw Revert) near the top of a method.
 */
function findGuardChecks(method, sourceFile) {
    const guards = [];
    if (!method.body)
        return guards;
    for (const stmt of method.body.statements) {
        // Look for: if (condition) { throw new Revert(...) }
        if (ts.isIfStatement(stmt)) {
            const condition = stmt.expression.getText(sourceFile);
            const thenText = stmt.thenStatement.getText(sourceFile);
            if (thenText.includes('Revert')) {
                const msgMatch = thenText.match(/Revert\s*\(\s*['"]([^'"]*)['"]\s*\)/);
                guards.push({
                    condition,
                    message: msgMatch ? msgMatch[1] : '',
                    pos: stmt.getStart(),
                });
            }
        }
        // Also: function call guards like this.onlyDeployer(), this.ensureOwner(), etc.
        if (ts.isExpressionStatement(stmt)) {
            const text = stmt.getText(sourceFile);
            if (text.includes('onlyDeployer') ||
                text.includes('ensureOwner') ||
                text.includes('ensureActive') ||
                text.includes('requireActive')) {
                guards.push({
                    condition: text.replace(';', '').trim(),
                    message: '',
                    pos: stmt.getStart(),
                });
            }
        }
    }
    return guards;
}
/**
 * Check if a method has the @method decorator (OPNet public method).
 */
function hasMethodDecorator(method, sourceFile) {
    if (ts.canHaveDecorators(method)) {
        const decorators = ts.getDecorators(method);
        if (decorators) {
            for (const dec of decorators) {
                const text = dec.expression.getText(sourceFile);
                if (text.startsWith('method'))
                    return true;
            }
        }
    }
    const fullText = method.getText(sourceFile);
    if (fullText.match(/@method\b/))
        return true;
    const start = method.getFullStart();
    const leadingText = sourceFile.getFullText().substring(Math.max(0, start - 200), start);
    if (leadingText.match(/@method\b/))
        return true;
    return false;
}
/**
 * Check if a method is public.
 */
function isPublicMethod(method) {
    if (!method.modifiers)
        return true; // default is public in TS
    for (const mod of method.modifiers) {
        if (mod.kind === ts.SyntaxKind.PrivateKeyword)
            return false;
        if (mod.kind === ts.SyntaxKind.ProtectedKeyword)
            return false;
    }
    return true;
}
/**
 * Parse a source file for AST analysis.
 */
function createSourceFile(filePath, source) {
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
//# sourceMappingURL=ast-utils.js.map