// ============================================================================
// opspec Template Generator — Auto-generates spec annotations from code
// ============================================================================

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
    findClassDeclarations,
    getClassName,
    getBaseClassName,
    getClassMethods,
    getClassProperties,
    getMethodName,
    detectStoredFields,
    methodBodyContains,
    getMethodBodyText,
    findBlockchainCalls,
    findGuardChecks,
    isPublicMethod,
    hasMethodDecorator,
    walkTree,
    createSourceFile,
} from './ast-utils';

// ============================================================================
// Types
// ============================================================================

interface GeneratedAnnotation {
    tag: string;
    expression: string;
    comment?: string;
}

interface MethodTemplate {
    methodName: string;
    isPublic: boolean;
    annotations: GeneratedAnnotation[];
}

interface ContractTemplate {
    className: string;
    baseClass?: string;
    classAnnotations: GeneratedAnnotation[];
    methods: MethodTemplate[];
}

// ============================================================================
// Detection Helpers
// ============================================================================

/**
 * Detect access control patterns and return the access level.
 */
function detectAccessLevel(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): string | null {
    const bodyText = getMethodBodyText(method, sourceFile);

    if (bodyText.includes('onlyDeployer') || bodyText.includes('this.onlyDeployer')) {
        return 'deployer-only';
    }
    if (bodyText.includes('ensureOwner') || bodyText.includes('this.ensureOwner')) {
        return 'owner-only';
    }
    if (bodyText.includes('onlyOwner') || bodyText.includes('this.onlyOwner')) {
        return 'owner-only';
    }
    // If it's a public method without access checks, it's likely "anyone"
    if (isPublicMethod(method)) {
        return 'anyone';
    }
    return null;
}

/**
 * Detect state guards from if-statements that check stored booleans.
 */
function detectStateGuards(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    storedFields: Map<string, string>,
): GeneratedAnnotation[] {
    const annotations: GeneratedAnnotation[] = [];
    const guards = findGuardChecks(method, sourceFile);
    const methodName = getMethodName(method);

    for (const guard of guards) {
        const condition = guard.condition;

        // Check for boolean field guards like: this.graduated.value, this.initialized.value
        for (const [field, type] of storedFields) {
            if (type === 'StoredBoolean' || type === 'StoredU256') {
                if (condition.includes(`this.${field}.value`)) {
                    // Determine if it's a positive or negative check
                    const isNegated = condition.includes('!') || condition.includes('eq(') && condition.includes('Zero');
                    const msg = guard.message ? ` // "${guard.message}"` : '';

                    annotations.push({
                        tag: 'pre',
                        expression: isNegated
                            ? `!this.${field}.value${msg}`
                            : `this.${field}.value${msg}`,
                    });
                }
            }
        }

        // Check for status/state comparisons
        if (condition.includes('status') || condition.includes('Status') || condition.includes('state')) {
            const msg = guard.message ? ` // "${guard.message}"` : '';
            annotations.push({
                tag: 'pre',
                expression: condition + msg,
            });
        }
    }

    return annotations;
}

/**
 * Detect cross-contract calls (Blockchain.call) and generate @calls annotations.
 */
function detectCrossContractCalls(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): GeneratedAnnotation[] {
    const annotations: GeneratedAnnotation[] = [];
    const calls = findBlockchainCalls(method, sourceFile);
    const bodyText = getMethodBodyText(method, sourceFile);

    if (calls.length === 0) return annotations;

    // Try to extract the target address from Blockchain.call(target, data) pattern
    for (const call of calls) {
        // Parse the call arguments
        const callText = call.text;
        const argsMatch = callText.match(/Blockchain\.call\s*\(\s*(\w+)/);
        if (argsMatch) {
            const targetVar = argsMatch[1];

            // Check if the result is checked for success
            const hasSuccessCheck = bodyText.includes('.success') || bodyText.includes('Revert');
            const expectation = hasSuccessCheck ? 'must-succeed' : 'unchecked';

            annotations.push({
                tag: 'calls',
                expression: `${targetVar} : <method>(...) -> ${expectation}`,
                comment: 'TODO: specify the actual method being called',
            });
        }
    }

    return annotations;
}

/**
 * Detect if a method follows CEI pattern.
 */
function shouldRecommendCEI(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    storedFieldNames: Set<string>,
): boolean {
    const calls = findBlockchainCalls(method, sourceFile);
    return calls.length > 0;
}

/**
 * Detect preconditions from calldata reads and guards.
 */
function detectPreconditions(
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): GeneratedAnnotation[] {
    const annotations: GeneratedAnnotation[] = [];
    const bodyText = getMethodBodyText(method, sourceFile);

    // Detect zero-check patterns: if (x.isZero()) throw new Revert(...)
    const zeroChecks = bodyText.match(/if\s*\([^)]*\.isZero\(\)[^)]*\)\s*\{?\s*throw\s+new\s+Revert\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    if (zeroChecks) {
        for (const check of zeroChecks) {
            const msgMatch = check.match(/Revert\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            const varMatch = check.match(/if\s*\(\s*([^)]+?)\.isZero/);
            if (varMatch) {
                const msg = msgMatch ? ` // "${msgMatch[1]}"` : '';
                annotations.push({
                    tag: 'pre',
                    expression: `!${varMatch[1].trim()}.isZero()${msg}`,
                });
            }
        }
    }

    // Detect address zero checks
    if (bodyText.includes('.isZero()') && bodyText.includes('address')) {
        // Already handled by the zero check above if it has Revert
    }

    return annotations;
}

/**
 * Detect state machine patterns across methods.
 */
function detectStateMachine(
    methods: ts.MethodDeclaration[],
    sourceFile: ts.SourceFile,
    storedFields: Map<string, string>,
): GeneratedAnnotation[] {
    const annotations: GeneratedAnnotation[] = [];

    // Find fields that act as state flags
    const stateFields: string[] = [];
    for (const [field, type] of storedFields) {
        if (
            field.toLowerCase().includes('status') ||
            field.toLowerCase().includes('state') ||
            field.toLowerCase().includes('initialized') ||
            field.toLowerCase().includes('graduated') ||
            field.toLowerCase().includes('active') ||
            field.toLowerCase().includes('paused')
        ) {
            stateFields.push(field);
        }
    }

    if (stateFields.length === 0) return annotations;

    // For each method, check which state fields it reads/writes
    for (const method of methods) {
        const bodyText = getMethodBodyText(method, sourceFile);
        const methodName = getMethodName(method);

        for (const field of stateFields) {
            const reads = bodyText.includes(`this.${field}.value`);
            const writes = bodyText.includes(`this.${field}.value =`) || bodyText.includes(`this.${field}.value=`);

            if (reads && writes) {
                annotations.push({
                    tag: 'state',
                    expression: `<FROM> -> <TO> : ${methodName}()`,
                    comment: `TODO: define states for ${field} transition`,
                });
            } else if (reads) {
                annotations.push({
                    tag: 'state',
                    expression: `<STATE> -> <STATE> : ${methodName}()`,
                    comment: `guards on ${field}`,
                });
            }
        }
    }

    // Deduplicate
    const seen = new Set<string>();
    return annotations.filter((a) => {
        const key = `${a.tag}:${a.expression}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ============================================================================
// Main Template Generation
// ============================================================================

/**
 * Generate spec templates for all contracts in a file.
 */
export function generateTemplates(filePath: string): ContractTemplate[] {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const sourceFile = createSourceFile(absolutePath, source);

    const templates: ContractTemplate[] = [];
    const classes = findClassDeclarations(sourceFile);

    for (const classDecl of classes) {
        templates.push(generateClassTemplate(classDecl, sourceFile));
    }

    return templates;
}

/**
 * Generate spec template for a single class.
 */
function generateClassTemplate(
    classDecl: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
): ContractTemplate {
    const className = getClassName(classDecl);
    const baseClass = getBaseClassName(classDecl);
    const storedFields = detectStoredFields(classDecl, sourceFile);
    const storedFieldNames = new Set(storedFields.keys());
    const methods = getClassMethods(classDecl);

    const template: ContractTemplate = {
        className,
        baseClass,
        classAnnotations: [],
        methods: [],
    };

    // Generate class-level annotations

    // @opnet selectors-sha256 if using encodeSelector
    const classText = classDecl.getText(sourceFile);
    if (classText.includes('encodeSelector')) {
        template.classAnnotations.push({
            tag: 'opnet',
            expression: 'selectors-sha256',
        });
    }

    // @opnet no-approve if contract doesn't use approve
    if (!classText.includes('.approve(')) {
        template.classAnnotations.push({
            tag: 'opnet',
            expression: 'no-approve',
        });
    }

    // @opnet address-two-params
    if (classText.includes('Address.fromString')) {
        template.classAnnotations.push({
            tag: 'opnet',
            expression: 'address-two-params',
        });
    }

    // Generate invariants for stored fields
    for (const [field, type] of storedFields) {
        if (type === 'StoredU256') {
            template.classAnnotations.push({
                tag: 'invariant',
                expression: `this.${field}.value >= u256.Zero`,
                comment: `TODO: refine ${field} invariant`,
            });
        }
    }

    // Detect state machine patterns
    const stateAnnotations = detectStateMachine(methods, sourceFile, storedFields);
    template.classAnnotations.push(...stateAnnotations);

    // Generate method-level templates
    for (const method of methods) {
        const methodName = getMethodName(method);
        const methodTemplate: MethodTemplate = {
            methodName,
            isPublic: isPublicMethod(method),
            annotations: [],
        };

        // Access control
        const accessLevel = detectAccessLevel(method, sourceFile);
        if (accessLevel) {
            methodTemplate.annotations.push({
                tag: 'access',
                expression: accessLevel,
            });
        }

        // Preconditions from guards
        const stateGuards = detectStateGuards(method, sourceFile, storedFields);
        methodTemplate.annotations.push(...stateGuards);

        // Preconditions from zero/validation checks
        const preconditions = detectPreconditions(method, sourceFile);
        methodTemplate.annotations.push(...preconditions);

        // Cross-contract calls
        const callAnnotations = detectCrossContractCalls(method, sourceFile);
        methodTemplate.annotations.push(...callAnnotations);

        // CEI recommendation
        if (shouldRecommendCEI(method, sourceFile, storedFieldNames)) {
            methodTemplate.annotations.push({
                tag: 'ensures',
                expression: 'CEI',
                comment: 'Checks-Effects-Interactions pattern',
            });
        }

        // Only include methods that have annotations
        if (methodTemplate.annotations.length > 0) {
            template.methods.push(methodTemplate);
        }
    }

    return template;
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format templates as annotated source comments.
 */
export function formatTemplatesAsAnnotations(templates: ContractTemplate[]): string {
    const lines: string[] = [];

    for (const tpl of templates) {
        lines.push(`// ============================================================`);
        lines.push(`// Spec Template: ${tpl.className}`);
        if (tpl.baseClass) {
            lines.push(`// extends ${tpl.baseClass}`);
        }
        lines.push(`// ============================================================`);
        lines.push('');

        // Class-level annotations
        if (tpl.classAnnotations.length > 0) {
            lines.push('// Place before the class declaration:');
            for (const ann of tpl.classAnnotations) {
                const comment = ann.comment ? `  // ${ann.comment}` : '';
                lines.push(`/// @${ann.tag} ${ann.expression}${comment}`);
            }
            lines.push('');
        }

        // Method-level annotations
        for (const methodTpl of tpl.methods) {
            lines.push(`// ${methodTpl.methodName}():`);
            for (const ann of methodTpl.annotations) {
                const comment = ann.comment ? `  // ${ann.comment}` : '';
                lines.push(`/// @${ann.tag} ${ann.expression}${comment}`);
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * Format templates as JSON.
 */
export function formatTemplatesAsJson(templates: ContractTemplate[]): string {
    return JSON.stringify(templates, null, 2);
}

/**
 * Generate an annotated version of the source file with spec templates inserted.
 */
export function generateAnnotatedSource(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const sourceFile = createSourceFile(absolutePath, source);
    const sourceLines = source.split('\n');

    const classes = findClassDeclarations(sourceFile);

    // Collect insertions: line number -> annotations to insert before that line
    const insertions = new Map<number, string[]>();

    for (const classDecl of classes) {
        const template = generateClassTemplate(classDecl, sourceFile);
        const storedFields = detectStoredFields(classDecl, sourceFile);
        const methods = getClassMethods(classDecl);

        // Class-level annotations → insert before the class declaration
        if (template.classAnnotations.length > 0) {
            const classLine = sourceFile.getLineAndCharacterOfPosition(classDecl.getStart(sourceFile)).line;
            const indent = getIndentation(sourceLines[classLine]);
            const anns: string[] = [];
            for (const ann of template.classAnnotations) {
                const comment = ann.comment ? `  // ${ann.comment}` : '';
                anns.push(`${indent}/// @${ann.tag} ${ann.expression}${comment}`);
            }
            insertions.set(classLine, anns);
        }

        // Method-level annotations → insert before each method
        for (const methodTpl of template.methods) {
            const method = methods.find((m) => getMethodName(m) === methodTpl.methodName);
            if (!method) continue;

            const methodLine = sourceFile.getLineAndCharacterOfPosition(method.getStart(sourceFile)).line;
            const indent = getIndentation(sourceLines[methodLine]);
            const anns: string[] = [];
            for (const ann of methodTpl.annotations) {
                const comment = ann.comment ? `  // ${ann.comment}` : '';
                anns.push(`${indent}/// @${ann.tag} ${ann.expression}${comment}`);
            }

            const existing = insertions.get(methodLine) || [];
            insertions.set(methodLine, [...existing, ...anns]);
        }
    }

    // Build the output with insertions
    const output: string[] = [];
    for (let i = 0; i < sourceLines.length; i++) {
        const toInsert = insertions.get(i);
        if (toInsert) {
            output.push(...toInsert);
        }
        output.push(sourceLines[i]);
    }

    return output.join('\n');
}

function getIndentation(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
}
