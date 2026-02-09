"use strict";
// ============================================================================
// opspec Coverage Analyzer — Shows spec coverage of contracts
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
exports.computeCoverage = computeCoverage;
exports.computeCoverageFromFile = computeCoverageFromFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ast_utils_1 = require("./ast-utils");
/**
 * Compute spec coverage for a contract.
 */
function computeCoverage(contract, sourceFile) {
    const classes = (0, ast_utils_1.findClassDeclarations)(sourceFile);
    const classDecl = classes.find((c) => (0, ast_utils_1.getClassName)(c) === contract.className);
    const coverage = {
        file: contract.file,
        contractName: contract.className,
        totalMethods: 0,
        specifiedMethods: 0,
        totalFields: 0,
        invariantCoveredFields: 0,
        methods: [],
    };
    if (!classDecl)
        return coverage;
    const methods = (0, ast_utils_1.getClassMethods)(classDecl);
    const storedFields = (0, ast_utils_1.detectStoredFields)(classDecl, sourceFile);
    // Count stored fields
    coverage.totalFields = storedFields.size;
    // Count invariant-covered fields
    const coveredFields = new Set();
    for (const inv of contract.invariants) {
        for (const field of inv.fieldReferences) {
            coveredFields.add(field);
        }
    }
    coverage.invariantCoveredFields = coveredFields.size;
    // Analyze each method
    for (const method of methods) {
        const methodName = (0, ast_utils_1.getMethodName)(method);
        // Skip internal/infrastructure methods
        if (methodName === 'constructor' || methodName === 'execute')
            continue;
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
function computeCoverageFromFile(filePath, contracts) {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const sourceFile = (0, ast_utils_1.createSourceFile)(absolutePath, source);
    const results = [];
    for (const contract of contracts) {
        if (path.resolve(contract.file) === absolutePath) {
            results.push(computeCoverage(contract, sourceFile));
        }
    }
    return results;
}
//# sourceMappingURL=coverage.js.map