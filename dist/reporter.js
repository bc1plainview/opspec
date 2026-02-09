"use strict";
// ============================================================================
// opspec Reporter — Formats verification results for output
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatReport = formatReport;
exports.formatReports = formatReports;
exports.formatReportsJson = formatReportsJson;
exports.formatCoverage = formatCoverage;
const chalk_1 = __importDefault(require("chalk"));
// ============================================================================
// Status Formatting
// ============================================================================
function colorStatus(status) {
    const label = status.padEnd(10);
    switch (status) {
        case 'VERIFIED':
            return chalk_1.default.green.bold(label);
        case 'UNVERIFIED':
            return chalk_1.default.yellow(label);
        case 'VIOLATED':
            return chalk_1.default.red.bold(label);
        case 'MISSING':
            return chalk_1.default.gray(label);
        default:
            return label;
    }
}
function statusIcon(status) {
    switch (status) {
        case 'VERIFIED':
            return chalk_1.default.green('✓');
        case 'UNVERIFIED':
            return chalk_1.default.yellow('?');
        case 'VIOLATED':
            return chalk_1.default.red('✗');
        case 'MISSING':
            return chalk_1.default.gray('○');
        default:
            return ' ';
    }
}
function tagColor(tag) {
    switch (tag) {
        case 'invariant':
            return chalk_1.default.magenta(`@${tag}`);
        case 'pre':
        case 'requires':
            return chalk_1.default.cyan(`@${tag}`);
        case 'post':
        case 'ensures':
            return chalk_1.default.blue(`@${tag}`);
        case 'access':
            return chalk_1.default.yellow(`@${tag}`);
        case 'calls':
            return chalk_1.default.green(`@${tag}`);
        case 'state':
            return chalk_1.default.red(`@${tag}`);
        case 'temporal':
            return chalk_1.default.gray(`@${tag}`);
        case 'opnet':
            return chalk_1.default.white.bold(`@${tag}`);
        default:
            return chalk_1.default.white(`@${tag}`);
    }
}
// ============================================================================
// Report Formatting
// ============================================================================
/**
 * Format a verification report as colored terminal output.
 */
function formatReport(report) {
    const lines = [];
    // Header
    lines.push('');
    lines.push(chalk_1.default.bold.underline(`${report.contractName}`) + chalk_1.default.gray(` — ${report.file}`));
    lines.push('');
    if (report.results.length === 0) {
        lines.push(chalk_1.default.gray('  No specifications found.'));
        lines.push('');
        return lines.join('\n');
    }
    // Group results by tag type
    const grouped = new Map();
    for (const r of report.results) {
        const tag = r.spec.tag;
        if (!grouped.has(tag))
            grouped.set(tag, []);
        grouped.get(tag).push(r);
    }
    // Display order
    const displayOrder = ['invariant', 'access', 'pre', 'requires', 'post', 'ensures', 'calls', 'state', 'temporal', 'opnet'];
    for (const tag of displayOrder) {
        const results = grouped.get(tag);
        if (!results || results.length === 0)
            continue;
        lines.push(`  ${tagColor(tag)}`);
        for (const r of results) {
            const icon = statusIcon(r.status);
            const status = colorStatus(r.status);
            const loc = chalk_1.default.gray(`L${r.line}`);
            lines.push(`    ${icon} ${status} ${loc}  ${r.message}`);
            if (r.details) {
                lines.push(`      ${chalk_1.default.gray('→')} ${chalk_1.default.gray(r.details)}`);
            }
        }
        lines.push('');
    }
    // Summary bar
    const s = report.summary;
    const parts = [];
    if (s.verified > 0)
        parts.push(chalk_1.default.green.bold(`${s.verified} verified`));
    if (s.unverified > 0)
        parts.push(chalk_1.default.yellow(`${s.unverified} unverified`));
    if (s.violated > 0)
        parts.push(chalk_1.default.red.bold(`${s.violated} violated`));
    if (s.missing > 0)
        parts.push(chalk_1.default.gray(`${s.missing} missing`));
    lines.push(`  ${chalk_1.default.bold('Summary:')} ${parts.join(chalk_1.default.gray(' · '))}  ${chalk_1.default.gray(`(${s.total} total)`)}`);
    lines.push('');
    return lines.join('\n');
}
/**
 * Format multiple reports.
 */
function formatReports(reports) {
    if (reports.length === 0) {
        return chalk_1.default.gray('No specifications found in the analyzed files.\n');
    }
    const lines = [];
    lines.push('');
    lines.push(chalk_1.default.bold.white('═══════════════════════════════════════════════════════════'));
    lines.push(chalk_1.default.bold.white('  opspec — OPNet Specification Verifier'));
    lines.push(chalk_1.default.bold.white('═══════════════════════════════════════════════════════════'));
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
    lines.push(chalk_1.default.bold.white('═══════════════════════════════════════════════════════════'));
    const grandParts = [];
    grandParts.push(chalk_1.default.green.bold(`${totals.verified} verified`));
    grandParts.push(chalk_1.default.yellow(`${totals.unverified} unverified`));
    grandParts.push(chalk_1.default.red.bold(`${totals.violated} violated`));
    grandParts.push(chalk_1.default.gray(`${totals.missing} missing`));
    lines.push(`  ${chalk_1.default.bold('Grand Total:')} ${grandParts.join(chalk_1.default.gray(' · '))}  ${chalk_1.default.gray(`(${totals.total} specs across ${reports.length} contract(s))`)}`);
    lines.push(chalk_1.default.bold.white('═══════════════════════════════════════════════════════════'));
    lines.push('');
    return lines.join('\n');
}
/**
 * Format reports as JSON.
 */
function formatReportsJson(reports) {
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
function formatCoverage(coverage) {
    const lines = [];
    lines.push('');
    lines.push(chalk_1.default.bold.underline(`${coverage.contractName}`) + chalk_1.default.gray(` — ${coverage.file}`));
    lines.push('');
    // Method coverage
    const specCount = coverage.specifiedMethods;
    const total = coverage.totalMethods;
    const pct = total > 0 ? Math.round((specCount / total) * 100) : 0;
    const pctColor = pct >= 80 ? chalk_1.default.green : pct >= 50 ? chalk_1.default.yellow : chalk_1.default.red;
    lines.push(`  ${chalk_1.default.bold('Method Coverage:')} ${pctColor(`${pct}%`)} (${specCount}/${total} methods have specs)`);
    lines.push('');
    // Per-method breakdown
    lines.push(`  ${chalk_1.default.bold('Method')}${' '.repeat(30)}${chalk_1.default.bold('Pre  Post Access Calls CEI')}`);
    lines.push(`  ${'─'.repeat(70)}`);
    for (const m of coverage.methods) {
        const name = m.name.padEnd(35);
        const pre = m.hasPreConditions ? chalk_1.default.green(' ✓ ') : chalk_1.default.gray(' · ');
        const post = m.hasPostConditions ? chalk_1.default.green('  ✓  ') : chalk_1.default.gray('  ·  ');
        const access = m.hasAccessSpec ? chalk_1.default.green('  ✓   ') : chalk_1.default.gray('  ·   ');
        const calls = m.hasCallsSpec ? chalk_1.default.green(' ✓  ') : chalk_1.default.gray(' ·  ');
        const cei = m.hasCEI ? chalk_1.default.green('  ✓') : chalk_1.default.gray('  ·');
        lines.push(`  ${name}${pre}${post}${access}${calls}${cei}`);
    }
    lines.push('');
    // Field coverage
    if (coverage.totalFields > 0) {
        const fieldPct = Math.round((coverage.invariantCoveredFields / coverage.totalFields) * 100);
        const fieldColor = fieldPct >= 80 ? chalk_1.default.green : fieldPct >= 50 ? chalk_1.default.yellow : chalk_1.default.red;
        lines.push(`  ${chalk_1.default.bold('Invariant Field Coverage:')} ${fieldColor(`${fieldPct}%`)} (${coverage.invariantCoveredFields}/${coverage.totalFields} stored fields in invariants)`);
    }
    lines.push('');
    return lines.join('\n');
}
//# sourceMappingURL=reporter.js.map