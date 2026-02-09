// ============================================================================
// opspec — OPNet Specification Language & Verifier
// ============================================================================

export * from './types';
export { parseFile, parseSource, parseDirectory, parsePath } from './spec-parser';
export { verifyContract, verifyFile } from './verifier';
export { formatReport, formatReports, formatReportsJson, formatCoverage } from './reporter';
export {
    generateTemplates,
    formatTemplatesAsAnnotations,
    formatTemplatesAsJson,
    generateAnnotatedSource,
} from './template-generator';
export { computeCoverage, computeCoverageFromFile } from './coverage';
