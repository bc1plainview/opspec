// ============================================================================
// opspec Coverage Analyzer — Shows spec coverage of contracts
// ============================================================================

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { ContractSpecs, CoverageInfo } from './types';
import {
    findClassDeclarations,
    getClassName,
    getClassMethods,
    getMethodName,
    detectStoredFields,
    isPublicMethod,
    createSourceFile,
} from './ast-utils';

/**
 * Compute spec coverage for a contract.
 */
export function computeCoverage(
    contract: ContractSpecs,
    sourceFile: ts.SourceFile,
): CoverageInfo {
    const classes = findClassDeclarations(sourceFile);
    const classDecl = classes.find((c) => getClassName(c) === contract.className);

    const coverage: CoverageInfo = {
        file: contract.file,
        contractName: contract.className,
        totalMethods: 0,
        specifiedMethods: 0,
        totalFields: 0,
        invariantCoveredFields: 0,
        methods: [],
    };

    if (!classDecl) return coverage;

    const methods = getClassMethods(classDecl);
    const storedFields = detectStoredFields(classDecl, sourceFile);

    // Count stored fields
    coverage.totalFields = storedFields.size;

    // Count invariant-covered fields
    const coveredFields = new Set<string>();
    for (const inv of contract.invariants) {
        for (const field of inv.fieldReferences) {
            coveredFields.add(field);
        }
    }
    coverage.invariantCoveredFields = coveredFields.size;

    // Analyze each method
    for (const method of methods) {
        const methodName = getMethodName(method);

        // Skip internal/infrastructure methods
        if (methodName === 'constructor' || methodName === 'execute') continue;

        coverage.totalMethods++;

        const specs = contract.methods.get(methodName);
        const hasSpecs = !!specs;

        const methodCoverage = {
            name: methodName,
            hasPreConditions: !!specs && specs.preconditions.length > 0,
            hasPostConditions: !!specs && specs.postconditions.length > 0,
            hasAccessSpec: !!specs && !!specs.access,
            hasCallsSpec: !!specs && specs.calls.length > 0,
            hasCEI: !!specs && specs.postconditions.some((p) => p.isCEI),
        };

        if (hasSpecs) {
            coverage.specifiedMethods++;
        }

        coverage.methods.push(methodCoverage);
    }

    return coverage;
}

/**
 * Compute coverage from a file.
 */
export function computeCoverageFromFile(
    filePath: string,
    contracts: ContractSpecs[],
): CoverageInfo[] {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const sourceFile = createSourceFile(absolutePath, source);

    const results: CoverageInfo[] = [];
    for (const contract of contracts) {
        if (path.resolve(contract.file) === absolutePath) {
            results.push(computeCoverage(contract, sourceFile));
        }
    }

    return results;
}
