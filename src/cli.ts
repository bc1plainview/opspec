#!/usr/bin/env node
// ============================================================================
// opspec CLI — OPNet Specification Language & Verifier
// ============================================================================

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { parsePath, parseFile } from './spec-parser';
import { verifyContract } from './verifier';
import {
    formatReports,
    formatReportsJson,
    formatCoverage,
} from './reporter';
import {
    generateTemplates,
    formatTemplatesAsAnnotations,
    formatTemplatesAsJson,
    generateAnnotatedSource,
} from './template-generator';
import { computeCoverage } from './coverage';
import { VerificationReport, ContractSpecs } from './types';
import * as ts from 'typescript';

const program = new Command();

program
    .name('opspec')
    .description('OPNet Specification Language & Static Verifier for AssemblyScript Smart Contracts')
    .version('1.0.0');

// ---- verify ----
program
    .command('verify')
    .description('Verify spec annotations against code')
    .argument('<path>', 'Path to a .ts file or directory')
    .option('-j, --json', 'Output as JSON', false)
    .action((targetPath: string, opts: { json: boolean }) => {
        try {
            const specTree = parsePath(targetPath);

            if (specTree.contracts.length === 0) {
                if (opts.json) {
                    console.log(JSON.stringify({ reports: [], message: 'No specifications found' }));
                } else {
                    console.log('No specifications found in the analyzed files.');
                    console.log('Use `opspec template <file>` to generate starter spec annotations.');
                }
                process.exit(0);
            }

            const reports: VerificationReport[] = [];

            for (const contract of specTree.contracts) {
                const absolutePath = path.resolve(contract.file);
                const source = fs.readFileSync(absolutePath, 'utf-8');
                const sourceFile = ts.createSourceFile(
                    absolutePath,
                    source,
                    ts.ScriptTarget.Latest,
                    true,
                    ts.ScriptKind.TS,
                );
                reports.push(verifyContract(contract, sourceFile));
            }

            if (opts.json) {
                console.log(formatReportsJson(reports));
            } else {
                console.log(formatReports(reports));
            }

            // Exit codes
            const hasViolations = reports.some((r) => r.summary.violated > 0);
            process.exit(hasViolations ? 1 : 0);
        } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(2);
        }
    });

// ---- check ----
program
    .command('check')
    .description('Parse and validate spec syntax (no verification against code)')
    .argument('<file>', 'Path to a .ts file')
    .option('-j, --json', 'Output as JSON', false)
    .action((filePath: string, opts: { json: boolean }) => {
        try {
            const specTree = parseFile(filePath);

            if (opts.json) {
                const output = {
                    file: filePath,
                    contracts: specTree.contracts.map((c) => ({
                        className: c.className,
                        invariants: c.invariants.length,
                        stateTransitions: c.stateTransitions.length,
                        opnetConstraints: c.opnetConstraints.length,
                        methods: Array.from(c.methods.entries()).map(([name, specs]) => ({
                            name,
                            preconditions: specs.preconditions.length,
                            postconditions: specs.postconditions.length,
                            access: specs.access?.level || null,
                            calls: specs.calls.length,
                            stateTransitions: specs.stateTransitions.length,
                            temporal: specs.temporal.length,
                        })),
                    })),
                    unassociated: specTree.unassociated.length,
                    valid: true,
                };
                console.log(JSON.stringify(output, null, 2));
            } else {
                console.log(`\nSpec Syntax Check: ${filePath}`);
                console.log('═'.repeat(60));

                if (specTree.contracts.length === 0) {
                    console.log('  No specifications found.');
                    console.log('  Use `opspec template <file>` to generate starter annotations.');
                } else {
                    for (const contract of specTree.contracts) {
                        console.log(`\n  Contract: ${contract.className}`);
                        console.log(`    Invariants:       ${contract.invariants.length}`);
                        console.log(`    State transitions: ${contract.stateTransitions.length}`);
                        console.log(`    OPNet constraints: ${contract.opnetConstraints.length}`);
                        console.log(`    Methods with specs: ${contract.methods.size}`);

                        for (const [name, specs] of contract.methods) {
                            const parts: string[] = [];
                            if (specs.preconditions.length) parts.push(`${specs.preconditions.length} pre`);
                            if (specs.postconditions.length) parts.push(`${specs.postconditions.length} post`);
                            if (specs.access) parts.push(`access: ${specs.access.level}`);
                            if (specs.calls.length) parts.push(`${specs.calls.length} calls`);
                            if (specs.stateTransitions.length) parts.push(`${specs.stateTransitions.length} state`);
                            if (specs.temporal.length) parts.push(`${specs.temporal.length} temporal`);
                            console.log(`      ${name}(): ${parts.join(', ')}`);
                        }
                    }
                }

                if (specTree.unassociated.length > 0) {
                    console.log(`\n  Unassociated annotations: ${specTree.unassociated.length}`);
                }

                console.log('\n  ✓ Spec syntax is valid.');
                console.log('');
            }
        } catch (err) {
            console.error(`Syntax Error: ${(err as Error).message}`);
            process.exit(1);
        }
    });

// ---- extract ----
program
    .command('extract')
    .description('Extract all specs as structured JSON')
    .argument('<file>', 'Path to a .ts file')
    .action((filePath: string) => {
        try {
            const specTree = parseFile(filePath);

            const output = {
                file: filePath,
                contracts: specTree.contracts.map((c) => ({
                    className: c.className,
                    file: c.file,
                    invariants: c.invariants.map((i) => ({
                        expression: i.expression,
                        fieldReferences: i.fieldReferences,
                        line: i.line,
                        comment: i.comment,
                    })),
                    stateTransitions: c.stateTransitions.map((s) => ({
                        expression: s.expression,
                        transition: s.transition,
                        line: s.line,
                    })),
                    opnetConstraints: c.opnetConstraints.map((o) => ({
                        constraint: o.constraint,
                        line: o.line,
                    })),
                    methods: Object.fromEntries(
                        Array.from(c.methods.entries()).map(([name, specs]) => [
                            name,
                            {
                                preconditions: specs.preconditions.map((p) => ({
                                    expression: p.expression,
                                    line: p.line,
                                    comment: p.comment,
                                })),
                                postconditions: specs.postconditions.map((p) => ({
                                    expression: p.expression,
                                    isCEI: p.isCEI,
                                    oldReferences: p.oldReferences,
                                    fieldReferences: p.fieldReferences,
                                    line: p.line,
                                    comment: p.comment,
                                })),
                                access: specs.access
                                    ? { level: specs.access.level, line: specs.access.line }
                                    : null,
                                calls: specs.calls.map((c) => ({
                                    target: c.target,
                                    calledMethod: c.calledMethod,
                                    expectation: c.expectation,
                                    line: c.line,
                                })),
                                stateTransitions: specs.stateTransitions.map((s) => ({
                                    transition: s.transition,
                                    line: s.line,
                                })),
                                temporal: specs.temporal.map((t) => ({
                                    subject: t.subject,
                                    condition: t.condition,
                                    line: t.line,
                                })),
                            },
                        ]),
                    ),
                })),
                unassociated: specTree.unassociated,
            };

            console.log(JSON.stringify(output, null, 2));
        } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
        }
    });

// ---- coverage ----
program
    .command('coverage')
    .description('Show spec coverage for methods and fields')
    .argument('<path>', 'Path to a .ts file or directory')
    .option('-j, --json', 'Output as JSON', false)
    .action((targetPath: string, opts: { json: boolean }) => {
        try {
            const specTree = parsePath(targetPath);
            const absolutePath = path.resolve(targetPath);

            // Get all unique files
            const files = new Set<string>();
            for (const c of specTree.contracts) {
                files.add(path.resolve(c.file));
            }

            // Also analyze files without specs to show uncovered methods
            const stat = fs.statSync(absolutePath);
            if (stat.isFile() && absolutePath.endsWith('.ts')) {
                files.add(absolutePath);
            } else if (stat.isDirectory()) {
                function walk(dir: string): void {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fp = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (!['node_modules', 'dist', '.git', 'build'].includes(entry.name)) walk(fp);
                        } else if (entry.name.endsWith('.ts')) {
                            files.add(fp);
                        }
                    }
                }
                walk(absolutePath);
            }

            const allCoverage: any[] = [];

            for (const filePath of files) {
                const source = fs.readFileSync(filePath, 'utf-8');
                const sourceFile = ts.createSourceFile(
                    filePath,
                    source,
                    ts.ScriptTarget.Latest,
                    true,
                    ts.ScriptKind.TS,
                );

                const classes = findClassDeclarationsFromSource(sourceFile);
                for (const classDecl of classes) {
                    const className = classDecl.name?.text || '<anonymous>';

                    // Find matching contract specs, or create empty
                    const contract = specTree.contracts.find(
                        (c) => c.className === className && path.resolve(c.file) === filePath,
                    ) || {
                        className,
                        file: filePath,
                        invariants: [],
                        stateTransitions: [],
                        opnetConstraints: [],
                        methods: new Map(),
                    };

                    const cov = computeCoverage(contract as ContractSpecs, sourceFile);
                    allCoverage.push(cov);
                }
            }

            if (opts.json) {
                console.log(JSON.stringify(allCoverage, null, 2));
            } else {
                if (allCoverage.length === 0) {
                    console.log('No contracts found.');
                } else {
                    for (const cov of allCoverage) {
                        console.log(formatCoverage(cov));
                    }
                }
            }
        } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
        }
    });

// ---- template ----
program
    .command('template')
    .description('Auto-generate spec annotation templates from code')
    .argument('<file>', 'Path to a .ts file')
    .option('-j, --json', 'Output as JSON', false)
    .option('-a, --annotate', 'Output the source file with annotations inserted', false)
    .action((filePath: string, opts: { json: boolean; annotate: boolean }) => {
        try {
            if (opts.annotate) {
                const annotated = generateAnnotatedSource(filePath);
                console.log(annotated);
            } else if (opts.json) {
                const templates = generateTemplates(filePath);
                console.log(formatTemplatesAsJson(templates));
            } else {
                const templates = generateTemplates(filePath);
                console.log(formatTemplatesAsAnnotations(templates));
            }
        } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
        }
    });

program.parse();

// Helper - inline to avoid circular dependency
function findClassDeclarationsFromSource(sourceFile: ts.SourceFile): ts.ClassDeclaration[] {
    const classes: ts.ClassDeclaration[] = [];
    function walk(node: ts.Node): void {
        if (ts.isClassDeclaration(node)) {
            classes.push(node);
        }
        ts.forEachChild(node, walk);
    }
    walk(sourceFile);
    return classes;
}
