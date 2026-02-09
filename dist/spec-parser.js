"use strict";
// ============================================================================
// opspec Spec Parser — Extracts specification annotations from AST nodes
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
exports.parseFile = parseFile;
exports.parseSource = parseSource;
exports.parseDirectory = parseDirectory;
exports.parsePath = parsePath;
const ts = __importStar(require("typescript"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ---- Annotation-line regex ----
// Matches: /// @tag expression // optional comment
// or:      *  @tag expression // optional comment  (inside JSDoc blocks)
const ANNOTATION_RE = /(?:\/\/\/\s*@(\w+)\s+(.*?)(?:\s*\/\/\s*(.*))?\s*$)|(?:\*\s*@(\w+)\s+(.*?)(?:\s*\/\/\s*(.*))?\s*$)/;
// Recognised spec tags
const SPEC_TAGS = new Set([
    'invariant',
    'pre',
    'requires',
    'post',
    'ensures',
    'state',
    'access',
    'calls',
    'temporal',
    'opnet',
]);
/**
 * Extract field references from an expression (e.g. this.foo.value, this.bar.value).
 */
function extractFieldReferences(expr) {
    const refs = [];
    const re = /this\.(\w+)\.value/g;
    let m;
    while ((m = re.exec(expr)) !== null) {
        refs.push(m[1]);
    }
    return [...new Set(refs)];
}
/**
 * Extract old() references from a postcondition expression.
 */
function extractOldReferences(expr) {
    const refs = [];
    const re = /old\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(expr)) !== null) {
        refs.push(m[1].trim());
    }
    return refs;
}
/**
 * Parse a state transition line like:
 *   ACTIVE -> GRADUATED : buy() [when realPillAccumulated >= graduationThreshold]
 *   !GRADUATED -> !GRADUATED : buy(), sell()
 */
function parseStateTransition(expr) {
    // from -> to : methods [when condition]
    const mainRe = /^([^\->]+)\s*->\s*([^:]+):\s*(.+)$/;
    const m = mainRe.exec(expr.trim());
    if (!m) {
        return { fromState: '?', toState: '?', methods: [], condition: expr.trim() };
    }
    const fromState = m[1].trim();
    const toState = m[2].trim();
    let rest = m[3].trim();
    let condition;
    const condRe = /\[when\s+(.+)\]$/;
    const condMatch = condRe.exec(rest);
    if (condMatch) {
        condition = condMatch[1].trim();
        rest = rest.slice(0, condMatch.index).trim();
    }
    const methods = rest
        .split(',')
        .map((s) => s.trim().replace(/\(\)$/, ''))
        .filter(Boolean);
    return { fromState, toState, methods, condition };
}
/**
 * Parse a @calls annotation like:
 *   this.pillAddress.value : transferFrom(sender, this, amount) -> must-succeed
 */
function parseCallsSpec(expr, methodName, file, line, column, comment) {
    const re = /^(.+?)\s*:\s*(.+?)\s*->\s*(.+)$/;
    const m = re.exec(expr.trim());
    if (!m) {
        return {
            tag: 'calls',
            expression: expr,
            target: expr.trim(),
            calledMethod: '',
            expectation: '',
            methodName,
            file,
            line,
            column,
            comment,
        };
    }
    return {
        tag: 'calls',
        expression: expr,
        target: m[1].trim(),
        calledMethod: m[2].trim(),
        expectation: m[3].trim(),
        methodName,
        file,
        line,
        column,
        comment,
    };
}
/**
 * Parse all spec annotations from the leading comments of a node.
 */
function parseAnnotationsFromNode(node, sourceFile, fileName) {
    const annotations = [];
    const fullText = sourceFile.getFullText();
    const nodeStart = node.getFullStart();
    const nodeTextStart = node.getStart(sourceFile);
    // Get the leading trivia (comments before the node)
    const leadingText = fullText.substring(nodeStart, nodeTextStart);
    const lines = leadingText.split('\n');
    let currentLineOffset = nodeStart;
    for (const rawLine of lines) {
        const lineLen = rawLine.length + 1; // +1 for newline
        const trimmed = rawLine.trim();
        // Check for /// @tag or * @tag
        if (trimmed.startsWith('///') || trimmed.startsWith('*') || trimmed.startsWith('/**')) {
            const match = ANNOTATION_RE.exec(trimmed);
            if (match) {
                const tag = (match[1] || match[4]);
                const expression = (match[2] || match[5] || '').trim();
                const comment = match[3] || match[6];
                if (SPEC_TAGS.has(tag)) {
                    const { line, character } = sourceFile.getLineAndCharacterOfPosition(currentLineOffset);
                    annotations.push({
                        tag: tag,
                        expression,
                        comment: comment?.trim(),
                        file: fileName,
                        line: line + 1,
                        column: character + 1,
                    });
                }
            }
        }
        currentLineOffset += lineLen;
    }
    return annotations;
}
/**
 * Build a MethodSpecs from a list of annotations and a method name.
 */
function buildMethodSpecs(methodName, annotations, fileName) {
    const specs = {
        methodName,
        preconditions: [],
        postconditions: [],
        calls: [],
        stateTransitions: [],
        temporal: [],
    };
    for (const ann of annotations) {
        switch (ann.tag) {
            case 'pre':
            case 'requires': {
                const pre = {
                    ...ann,
                    tag: ann.tag,
                    methodName,
                };
                specs.preconditions.push(pre);
                break;
            }
            case 'post': {
                const post = {
                    ...ann,
                    tag: 'post',
                    methodName,
                    isCEI: false,
                    oldReferences: extractOldReferences(ann.expression),
                    fieldReferences: extractFieldReferences(ann.expression),
                };
                specs.postconditions.push(post);
                break;
            }
            case 'ensures': {
                const isCEI = ann.expression.trim().toUpperCase() === 'CEI';
                const post = {
                    ...ann,
                    tag: 'ensures',
                    methodName,
                    isCEI,
                    oldReferences: isCEI ? [] : extractOldReferences(ann.expression),
                    fieldReferences: isCEI ? [] : extractFieldReferences(ann.expression),
                };
                specs.postconditions.push(post);
                break;
            }
            case 'access': {
                const access = {
                    ...ann,
                    tag: 'access',
                    level: ann.expression.trim(),
                    methodName,
                };
                specs.access = access;
                break;
            }
            case 'calls': {
                const callSpec = parseCallsSpec(ann.expression, methodName, ann.file, ann.line, ann.column, ann.comment);
                specs.calls.push(callSpec);
                break;
            }
            case 'state': {
                const transition = parseStateTransition(ann.expression);
                const stateSpec = {
                    ...ann,
                    tag: 'state',
                    transition,
                };
                specs.stateTransitions.push(stateSpec);
                break;
            }
            case 'temporal': {
                const temporal = {
                    ...ann,
                    tag: 'temporal',
                    subject: ann.expression.split(/\s+/)[0] || '',
                    condition: ann.expression,
                };
                specs.temporal.push(temporal);
                break;
            }
        }
    }
    return specs;
}
/**
 * Parse a complete file and return its SpecTree.
 */
function parseFile(filePath) {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    return parseSource(source, filePath);
}
/**
 * Parse source code string and return its SpecTree.
 */
function parseSource(source, fileName) {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const tree = {
        contracts: [],
        unassociated: [],
    };
    // Walk top-level statements looking for class declarations
    for (const stmt of sourceFile.statements) {
        if (ts.isClassDeclaration(stmt)) {
            const contractSpecs = parseClassSpecs(stmt, sourceFile, fileName);
            if (contractSpecs) {
                tree.contracts.push(contractSpecs);
            }
        }
    }
    // Also extract any file-level annotations (before the first class)
    if (sourceFile.statements.length > 0) {
        const first = sourceFile.statements[0];
        const preClassAnns = parseAnnotationsFromNode(first, sourceFile, fileName);
        // File-level annotations that aren't associated with a class
        // (e.g., @opnet selectors-sha256 at the top of a file)
        for (const ann of preClassAnns) {
            if (ann.tag === 'opnet' || ann.tag === 'invariant') {
                // Try to attach to the first contract found
                if (tree.contracts.length > 0) {
                    if (ann.tag === 'opnet') {
                        tree.contracts[0].opnetConstraints.push({
                            ...ann,
                            tag: 'opnet',
                            constraint: ann.expression.trim(),
                        });
                    }
                    else if (ann.tag === 'invariant') {
                        tree.contracts[0].invariants.push({
                            ...ann,
                            tag: 'invariant',
                            fieldReferences: extractFieldReferences(ann.expression),
                        });
                    }
                }
                else {
                    tree.unassociated.push(ann);
                }
            }
        }
    }
    return tree;
}
/**
 * Parse specs from a class declaration.
 */
function parseClassSpecs(classDecl, sourceFile, fileName) {
    const className = classDecl.name?.text || '<anonymous>';
    const contract = {
        className,
        file: fileName,
        invariants: [],
        stateTransitions: [],
        opnetConstraints: [],
        methods: new Map(),
    };
    // Parse class-level annotations (before the class keyword)
    const classAnns = parseAnnotationsFromNode(classDecl, sourceFile, fileName);
    for (const ann of classAnns) {
        switch (ann.tag) {
            case 'invariant': {
                contract.invariants.push({
                    ...ann,
                    tag: 'invariant',
                    fieldReferences: extractFieldReferences(ann.expression),
                });
                break;
            }
            case 'state': {
                contract.stateTransitions.push({
                    ...ann,
                    tag: 'state',
                    transition: parseStateTransition(ann.expression),
                });
                break;
            }
            case 'opnet': {
                contract.opnetConstraints.push({
                    ...ann,
                    tag: 'opnet',
                    constraint: ann.expression.trim(),
                });
                break;
            }
        }
    }
    // Parse method-level annotations
    for (const member of classDecl.members) {
        if (ts.isMethodDeclaration(member)) {
            const methodName = ts.isIdentifier(member.name)
                ? member.name.text
                : member.name.getText(sourceFile);
            const methodAnns = parseAnnotationsFromNode(member, sourceFile, fileName);
            if (methodAnns.length > 0) {
                const methodSpecs = buildMethodSpecs(methodName, methodAnns, fileName);
                contract.methods.set(methodName, methodSpecs);
                // Promote state transitions to contract level too
                for (const st of methodSpecs.stateTransitions) {
                    contract.stateTransitions.push(st);
                }
            }
        }
    }
    // Only return if there are any specs at all
    const hasSpecs = contract.invariants.length > 0 ||
        contract.stateTransitions.length > 0 ||
        contract.opnetConstraints.length > 0 ||
        contract.methods.size > 0;
    return hasSpecs ? contract : null;
}
/**
 * Parse all .ts files in a directory recursively.
 */
function parseDirectory(dirPath) {
    const tree = { contracts: [], unassociated: [] };
    const absolutePath = path.resolve(dirPath);
    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', 'dist', '.git', 'build'].includes(entry.name))
                    continue;
                walk(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith('.ts')) {
                try {
                    const fileTree = parseFile(fullPath);
                    tree.contracts.push(...fileTree.contracts);
                    tree.unassociated.push(...fileTree.unassociated);
                }
                catch (err) {
                    // Skip files that can't be parsed
                    console.error(`Warning: Could not parse ${fullPath}: ${err.message}`);
                }
            }
        }
    }
    walk(absolutePath);
    return tree;
}
/**
 * Parse a file or directory.
 */
function parsePath(targetPath) {
    const absolutePath = path.resolve(targetPath);
    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) {
        return parseFile(targetPath);
    }
    else if (stat.isDirectory()) {
        return parseDirectory(targetPath);
    }
    return { contracts: [], unassociated: [] };
}
//# sourceMappingURL=spec-parser.js.map