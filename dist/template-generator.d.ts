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
/**
 * Generate spec templates for all contracts in a file.
 */
export declare function generateTemplates(filePath: string): ContractTemplate[];
/**
 * Format templates as annotated source comments.
 */
export declare function formatTemplatesAsAnnotations(templates: ContractTemplate[]): string;
/**
 * Format templates as JSON.
 */
export declare function formatTemplatesAsJson(templates: ContractTemplate[]): string;
/**
 * Generate an annotated version of the source file with spec templates inserted.
 */
export declare function generateAnnotatedSource(filePath: string): string;
export {};
//# sourceMappingURL=template-generator.d.ts.map