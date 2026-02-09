import * as ts from 'typescript';
/**
 * Walk all nodes in an AST tree depth-first.
 */
export declare function walkTree(node: ts.Node, callback: (node: ts.Node) => void): void;
/**
 * Find all class declarations in a source file.
 */
export declare function findClassDeclarations(sourceFile: ts.SourceFile): ts.ClassDeclaration[];
/**
 * Get the class name, or '<anonymous>'.
 */
export declare function getClassName(node: ts.ClassDeclaration): string;
/**
 * Get the base class name.
 */
export declare function getBaseClassName(node: ts.ClassDeclaration): string | undefined;
/**
 * Get all method declarations from a class.
 */
export declare function getClassMethods(classDecl: ts.ClassDeclaration): ts.MethodDeclaration[];
/**
 * Get the method name as a string.
 */
export declare function getMethodName(method: ts.MethodDeclaration): string;
/**
 * Get all property declarations from a class.
 */
export declare function getClassProperties(classDecl: ts.ClassDeclaration): ts.PropertyDeclaration[];
/**
 * Detect stored fields in a class (StoredU256, StoredAddress, StoredBoolean, etc.)
 */
export declare function detectStoredFields(classDecl: ts.ClassDeclaration, sourceFile: ts.SourceFile): Map<string, string>;
/**
 * Check if a method body contains a text pattern.
 */
export declare function methodBodyContains(method: ts.MethodDeclaration, pattern: string | RegExp, sourceFile?: ts.SourceFile): boolean;
/**
 * Get the body text of a method.
 */
export declare function getMethodBodyText(method: ts.MethodDeclaration, sourceFile?: ts.SourceFile): string;
/**
 * Find all Blockchain.call() expressions in a method.
 */
export declare function findBlockchainCalls(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): {
    pos: number;
    text: string;
}[];
/**
 * Find all state writes (this.field.value = ...) in a method.
 */
export declare function findStateWrites(method: ts.MethodDeclaration, sourceFile: ts.SourceFile, storedFields: Set<string>): {
    pos: number;
    field: string;
    text: string;
}[];
/**
 * Find guard checks (if condition -> throw Revert) near the top of a method.
 */
export declare function findGuardChecks(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): {
    condition: string;
    message: string;
    pos: number;
}[];
/**
 * Check if a method has the @method decorator (OPNet public method).
 */
export declare function hasMethodDecorator(method: ts.MethodDeclaration, sourceFile: ts.SourceFile): boolean;
/**
 * Check if a method is public.
 */
export declare function isPublicMethod(method: ts.MethodDeclaration): boolean;
/**
 * Parse a source file for AST analysis.
 */
export declare function createSourceFile(filePath: string, source: string): ts.SourceFile;
//# sourceMappingURL=ast-utils.d.ts.map