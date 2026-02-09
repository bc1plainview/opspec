// ============================================================================
// opspec AST Utilities — Shared TypeScript AST helpers
// ============================================================================

import * as ts from 'typescript';

/**
 * Walk all nodes in an AST tree depth-first.
 */
export function walkTree(node: ts.Node, callback: (node: ts.Node) => void): void {
    callback(node);
    ts.forEachChild(node, (child) => walkTree(child, callback));
}

/**
 * Find all class declarations in a source file.
 */
export function findClassDeclarations(sourceFile: ts.SourceFile): ts.ClassDeclaration[] {
    const classes: ts.ClassDeclaration[] = [];
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
export function getClassName(node: ts.ClassDeclaration): string {
    return node.name?.text || '<anonymous>';
}

/**
 * Get the base class name.
 */
export function getBaseClassName(node: ts.ClassDeclaration): string | undefined {
    if (!node.heritageClauses) return undefined;
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
export function getClassMethods(classDecl: ts.ClassDeclaration): ts.MethodDeclaration[] {
    const methods: ts.MethodDeclaration[] = [];
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
export function getMethodName(method: ts.MethodDeclaration): string {
    if (ts.isIdentifier(method.name)) {
        return method.name.text;
    }
    return method.name.getText();
}

/**
 * Get all property declarations from a class.
 */
export function getClassProperties(classDecl: ts.ClassDeclaration): ts.PropertyDeclaration[] {
    const props: ts.PropertyDeclaration[] = [];
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
export function detectStoredFields(
    classDecl: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
): Map<string, string> {
    const stored = new Map<string, string>(); // fieldName -> type
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
export function methodBodyContains(
    method: ts.MethodDeclaration,
    pattern: string | RegExp,
    sourceFile?: ts.SourceFile,
): boolean {
    if (!method.body) return false;
    const bodyText = sourceFile ? method.body.getText(sourceFile) : method.body.getText();
    if (typeof pattern === 'string') {
        return bodyText.includes(pattern);
    }
    return pattern.test(bodyText);
}

/**
 * Get the body text of a method.
 */
export function getMethodBodyText(method: ts.MethodDeclaration, sourceFile?: ts.SourceFile): string {
    if (!method.body) return '';
    return sourceFile ? method.body.getText(sourceFile) : method.body.getText();
}

/**
 * Find all Blockchain.call() expressions in a method.
 */
export function findBlockchainCalls(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): { pos: number; text: string }[] {
    const calls: { pos: number; text: string }[] = [];
    if (!method.body) return calls;

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
export function findStateWrites(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    storedFields: Set<string>,
): { pos: number; field: string; text: string }[] {
    const writes: { pos: number; field: string; text: string }[] = [];
    if (!method.body) return writes;

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
export function findGuardChecks(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): { condition: string; message: string; pos: number }[] {
    const guards: { condition: string; message: string; pos: number }[] = [];
    if (!method.body) return guards;

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
            if (
                text.includes('onlyDeployer') ||
                text.includes('ensureOwner') ||
                text.includes('ensureActive') ||
                text.includes('requireActive')
            ) {
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
export function hasMethodDecorator(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): boolean {
    if (ts.canHaveDecorators(method)) {
        const decorators = ts.getDecorators(method);
        if (decorators) {
            for (const dec of decorators) {
                const text = dec.expression.getText(sourceFile);
                if (text.startsWith('method')) return true;
            }
        }
    }

    const fullText = method.getText(sourceFile);
    if (fullText.match(/@method\b/)) return true;

    const start = method.getFullStart();
    const leadingText = sourceFile.getFullText().substring(Math.max(0, start - 200), start);
    if (leadingText.match(/@method\b/)) return true;

    return false;
}

/**
 * Check if a method is public.
 */
export function isPublicMethod(method: ts.MethodDeclaration): boolean {
    if (!method.modifiers) return true; // default is public in TS
    for (const mod of method.modifiers) {
        if (mod.kind === ts.SyntaxKind.PrivateKeyword) return false;
        if (mod.kind === ts.SyntaxKind.ProtectedKeyword) return false;
    }
    return true;
}

/**
 * Parse a source file for AST analysis.
 */
export function createSourceFile(filePath: string, source: string): ts.SourceFile {
    return ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
}
