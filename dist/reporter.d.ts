import { VerificationReport, CoverageInfo } from './types';
/**
 * Format a verification report as colored terminal output.
 */
export declare function formatReport(report: VerificationReport): string;
/**
 * Format multiple reports.
 */
export declare function formatReports(reports: VerificationReport[]): string;
/**
 * Format reports as JSON.
 */
export declare function formatReportsJson(reports: VerificationReport[]): string;
/**
 * Format coverage information.
 */
export declare function formatCoverage(coverage: CoverageInfo): string;
//# sourceMappingURL=reporter.d.ts.map