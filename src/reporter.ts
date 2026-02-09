// ============================================================================
// opspec Reporter — Formats verification results for output
// ============================================================================

import chalk from 'chalk';
import { VerificationReport, VerificationResult, VerificationStatus, CoverageInfo } from './types';

// ============================================================================
// Status Formatting
// ============================================================================

function colorStatus(status: VerificationStatus): string {
    const label = status.padEnd(10);
    switch (status) {
        case 'VERIFIED':
            return chalk.green.bold(label);
        case 'UNVERIFIED':
            return chalk.yellow(label);
        case 'VIOLATED':
            return chalk.red.bold(label);
        case 'MISSING':
            return chalk.gray(label);
        default:
            return label;
    }
}

function statusIcon(status: VerificationStatus): string {
    switch (status) {
        case 'VERIFIED':
            return chalk.green('✓');
        case 'UNVERIFIED':
            return chalk.yellow('?');
        case 'VIOLATED':
            return chalk.red('✗');
        case 'MISSING':
            return chalk.gray('○');
        default:
            return ' ';
    }
}

function tagColor(tag: string): string {
    switch (tag) {
        case 'invariant':
            return chalk.magenta(`@${tag}`);
        case 'pre':
        case 'requires':
            return chalk.cyan(`@${tag}`);
        case 'post':
        case 'ensures':
            return chalk.blue(`@${tag}`);
        case 'access':
            return chalk.yellow(`@${tag}`);
        case 'calls':
            return chalk.green(`@${tag}`);
        case 'state':
            return chalk.red(`@${tag}`);
        case 'temporal':
            return chalk.gray(`@${tag}`);
        case 'opnet':
            return chalk.white.bold(`@${tag}`);
        default:
            return chalk.white(`@${tag}`);
    }
}

// ============================================================================
// Report Formatting
// ============================================================================

/**
 * Format a verification report as colored terminal output.
 */
export function formatReport(report: VerificationReport): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(chalk.bold.underline(`${report.contractName}`) + chalk.gray(` — ${report.file}`));
    lines.push('');

    if (report.results.length === 0) {
        lines.push(chalk.gray('  No specifications found.'));
        lines.push('');
        return lines.join('\n');
    }

    // Group results by tag type
    const grouped = new Map<string, VerificationResult[]>();
    for (const r of report.results) {
        const tag = r.spec.tag;
        if (!grouped.has(tag)) grouped.set(tag, []);
        grouped.get(tag)!.push(r);
    }

    // Display order
    const displayOrder = ['invariant', 'access', 'pre', 'requires', 'post', 'ensures', 'calls', 'state', 'temporal', 'opnet'];

    for (const tag of displayOrder) {
        const results = grouped.get(tag);
        if (!results || results.length === 0) continue;

        lines.push(`  ${tagColor(tag)}`);
        for (const r of results) {
            const icon = statusIcon(r.status);
            const status = colorStatus(r.status);
            const loc = chalk.gray(`L${r.line}`);
            lines.push(`    ${icon} ${status} ${loc}  ${r.message}`);
            if (r.details) {
                lines.push(`      ${chalk.gray('→')} ${chalk.gray(r.details)}`);
            }
        }
        lines.push('');
    }

    // Summary bar
    const s = report.summary;
    const parts: string[] = [];
    if (s.verified > 0) parts.push(chalk.green.bold(`${s.verified} verified`));
    if (s.unverified > 0) parts.push(chalk.yellow(`${s.unverified} unverified`));
    if (s.violated > 0) parts.push(chalk.red.bold(`${s.violated} violated`));
    if (s.missing > 0) parts.push(chalk.gray(`${s.missing} missing`));
    lines.push(`  ${chalk.bold('Summary:')} ${parts.join(chalk.gray(' · '))}  ${chalk.gray(`(${s.total} total)`)}`);
    lines.push('');

    return lines.join('\n');
}

/**
 * Format multiple reports.
 */
export function formatReports(reports: VerificationReport[]): string {
    if (reports.length === 0) {
        return chalk.gray('No specifications found in the analyzed files.\n');
    }

    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.bold.white('═══════════════════════════════════════════════════════════'));
    lines.push(chalk.bold.white('  opspec — OPNet Specification Verifier'));
    lines.push(chalk.bold.white('═══════════════════════════════════════════════════════════'));

    for (const report of reports) {
        lines.push(formatReport(report));
    }

    // Grand total
    const totals = {
        verified: 0,
        unverified: 0,
        violated: 0,
        missing: 0,
        total: 0,
    };
    for (const r of reports) {
        totals.verified += r.summary.verified;
        totals.unverified += r.summary.unverified;
        totals.violated += r.summary.violated;
        totals.missing += r.summary.missing;
        totals.total += r.summary.total;
    }

    lines.push(chalk.bold.white('═══════════════════════════════════════════════════════════'));
    const grandParts: string[] = [];
    grandParts.push(chalk.green.bold(`${totals.verified} verified`));
    grandParts.push(chalk.yellow(`${totals.unverified} unverified`));
    grandParts.push(chalk.red.bold(`${totals.violated} violated`));
    grandParts.push(chalk.gray(`${totals.missing} missing`));
    lines.push(`  ${chalk.bold('Grand Total:')} ${grandParts.join(chalk.gray(' · '))}  ${chalk.gray(`(${totals.total} specs across ${reports.length} contract(s))`)}`);
    lines.push(chalk.bold.white('═══════════════════════════════════════════════════════════'));
    lines.push('');

    return lines.join('\n');
}

/**
 * Format reports as JSON.
 */
export function formatReportsJson(reports: VerificationReport[]): string {
    const jsonReports = reports.map((r) => ({
        contractName: r.contractName,
        file: r.file,
        results: r.results.map((res) => ({
            tag: res.spec.tag,
            expression: res.spec.expression,
            status: res.status,
            message: res.message,
            details: res.details,
            file: res.file,
            line: res.line,
        })),
        summary: r.summary,
    }));

    return JSON.stringify({ reports: jsonReports }, null, 2);
}

/**
 * Format coverage information.
 */
export function formatCoverage(coverage: CoverageInfo): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.bold.underline(`${coverage.contractName}`) + chalk.gray(` — ${coverage.file}`));
    lines.push('');

    // Method coverage
    const specCount = coverage.specifiedMethods;
    const total = coverage.totalMethods;
    const pct = total > 0 ? Math.round((specCount / total) * 100) : 0;
    const pctColor = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;

    lines.push(`  ${chalk.bold('Method Coverage:')} ${pctColor(`${pct}%`)} (${specCount}/${total} methods have specs)`);
    lines.push('');

    // Per-method breakdown
    lines.push(`  ${chalk.bold('Method')}${' '.repeat(30)}${chalk.bold('Pre  Post Access Calls CEI')}`);
    lines.push(`  ${'─'.repeat(70)}`);

    for (const m of coverage.methods) {
        const name = m.name.padEnd(35);
        const pre = m.hasPreConditions ? chalk.green(' ✓ ') : chalk.gray(' · ');
        const post = m.hasPostConditions ? chalk.green('  ✓  ') : chalk.gray('  ·  ');
        const access = m.hasAccessSpec ? chalk.green('  ✓   ') : chalk.gray('  ·   ');
        const calls = m.hasCallsSpec ? chalk.green(' ✓  ') : chalk.gray(' ·  ');
        const cei = m.hasCEI ? chalk.green('  ✓') : chalk.gray('  ·');

        lines.push(`  ${name}${pre}${post}${access}${calls}${cei}`);
    }

    lines.push('');

    // Field coverage
    if (coverage.totalFields > 0) {
        const fieldPct = Math.round((coverage.invariantCoveredFields / coverage.totalFields) * 100);
        const fieldColor = fieldPct >= 80 ? chalk.green : fieldPct >= 50 ? chalk.yellow : chalk.red;
        lines.push(`  ${chalk.bold('Invariant Field Coverage:')} ${fieldColor(`${fieldPct}%`)} (${coverage.invariantCoveredFields}/${coverage.totalFields} stored fields in invariants)`);
    }

    lines.push('');

    return lines.join('\n');
}
