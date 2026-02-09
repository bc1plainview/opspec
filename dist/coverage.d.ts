import * as ts from 'typescript';
import { ContractSpecs, CoverageInfo } from './types';
/**
 * Compute spec coverage for a contract.
 */
export declare function computeCoverage(contract: ContractSpecs, sourceFile: ts.SourceFile): CoverageInfo;
/**
 * Compute coverage from a file.
 */
export declare function computeCoverageFromFile(filePath: string, contracts: ContractSpecs[]): CoverageInfo[];
//# sourceMappingURL=coverage.d.ts.map