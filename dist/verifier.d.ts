import * as ts from 'typescript';
import { ContractSpecs, VerificationReport } from './types';
/**
 * Verify a single contract's specs against its source code.
 */
export declare function verifyContract(contract: ContractSpecs, sourceFile: ts.SourceFile): VerificationReport;
/**
 * Verify specs from a file path.
 */
export declare function verifyFile(filePath: string, specTree: {
    contracts: ContractSpecs[];
}): VerificationReport[];
//# sourceMappingURL=verifier.d.ts.map