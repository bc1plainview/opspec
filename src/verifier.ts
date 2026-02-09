// ============================================================================
// opspec Static Verifier — Checks code against specifications
// ============================================================================

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import {
    ContractSpecs,
    MethodSpecs,
    VerificationResult,
    VerificationReport,
    VerificationStatus,
    SpecAnnotation,
    PreconditionSpec,
    PostconditionSpec,
    AccessSpec,
    CallsSpec,
    InvariantSpec,
    StateSpec,
    OpnetSpec,
} from './types';
import {
    walkTree,
    findClassDeclarations,
    getClassName,
    getClassMethods,
    getMethodName,
    detectStoredFields,
    methodBodyContains,
    getMethodBodyText,
    findBlockchainCalls,
    findStateWrites,
    findGuardChecks,
    isPublicMethod,
    createSourceFile,
} from './ast-utils';

// ============================================================================
// Individual Verifier Functions
// ============================================================================

/**
 * Verify @access specs.
 *
 * - deployer-only / owner-only → method must call onlyDeployer/ensureOwner
 * - anyone → method should NOT have deployer/owner checks
 */
function verifyAccess(
    accessSpec: AccessSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): VerificationResult {
    const bodyText = getMethodBodyText(method, sourceFile);
    const level = accessSpec.level.toLowerCase();

    if (level === 'deployer-only') {
        // Strip comments from body text to avoid false positives
        const bodyNoComments = stripComments(bodyText);
        const hasDeployerCheck =
            bodyNoComments.includes('onlyDeployer') ||
            bodyNoComments.includes('this.onlyDeployer');
        if (hasDeployerCheck) {
            return makeResult(accessSpec, 'VERIFIED', `Method ${accessSpec.methodName}() has onlyDeployer check`);
        }
        // Also check for manual sender comparison patterns
        const hasSenderCheck =
            bodyNoComments.includes('Blockchain.tx.sender') &&
            (bodyNoComments.includes('deployer') || bodyNoComments.includes('owner'));
        if (hasSenderCheck) {
            return makeResult(accessSpec, 'VERIFIED', `Method ${accessSpec.methodName}() has sender/deployer comparison`);
        }
        return makeResult(
            accessSpec,
            'VIOLATED',
            `Method ${accessSpec.methodName}() is specified as deployer-only but has no onlyDeployer() call`,
            'Add this.onlyDeployer(Blockchain.tx.sender) at the start of the method',
        );
    }

    if (level === 'owner-only') {
        const bodyNoComments = stripComments(bodyText);
        const hasOwnerCheck =
            bodyNoComments.includes('ensureOwner') ||
            bodyNoComments.includes('this.ensureOwner') ||
            bodyNoComments.includes('onlyOwner') ||
            bodyNoComments.includes('this.onlyOwner');
        if (hasOwnerCheck) {
            return makeResult(accessSpec, 'VERIFIED', `Method ${accessSpec.methodName}() has owner check`);
        }
        // Check for manual owner pattern
        const hasManualOwnerCheck =
            bodyNoComments.includes('this.owner.value') &&
            bodyNoComments.includes('Blockchain.tx.sender');
        if (hasManualOwnerCheck) {
            return makeResult(accessSpec, 'VERIFIED', `Method ${accessSpec.methodName}() has manual owner comparison`);
        }
        return makeResult(
            accessSpec,
            'VIOLATED',
            `Method ${accessSpec.methodName}() is specified as owner-only but has no owner check`,
            'Add this.ensureOwner() or owner comparison at the start of the method',
        );
    }

    if (level === 'anyone') {
        const hasRestriction =
            bodyText.includes('onlyDeployer') ||
            bodyText.includes('ensureOwner') ||
            bodyText.includes('onlyOwner');
        if (hasRestriction) {
            return makeResult(
                accessSpec,
                'VIOLATED',
                `Method ${accessSpec.methodName}() is specified as @access anyone but has access restriction`,
            );
        }
        return makeResult(accessSpec, 'VERIFIED', `Method ${accessSpec.methodName}() has no access restrictions (open to anyone)`);
    }

    return makeResult(accessSpec, 'UNVERIFIED', `Unknown access level: ${level}`);
}

/**
 * Verify @pre / @requires specs.
 *
 * Checks that the method body has guard checks (if/throw Revert) that correspond
 * to the precondition expression. This is a heuristic match.
 */
function verifyPrecondition(
    preSpec: PreconditionSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): VerificationResult {
    const expr = preSpec.expression.trim();
    const bodyText = getMethodBodyText(method, sourceFile);
    const guards = findGuardChecks(method, sourceFile);

    // Special case: check for function-call guards like this.ensureActive(), this.ensureOwner()
    if (expr.includes('ensureOwner') || expr.includes('onlyDeployer')) {
        if (bodyText.includes('ensureOwner') || bodyText.includes('onlyDeployer')) {
            return makeResult(preSpec, 'VERIFIED', `Precondition guard found: ${expr}`);
        }
        return makeResult(preSpec, 'VIOLATED', `Missing guard for precondition: ${expr}`);
    }

    if (expr.includes('ensureActive')) {
        if (bodyText.includes('ensureActive')) {
            return makeResult(preSpec, 'VERIFIED', `Precondition guard found: ${expr}`);
        }
        return makeResult(preSpec, 'VIOLATED', `Missing guard for precondition: ${expr}`);
    }

    // Check for status/state related preconditions that use helper functions
    if (expr.includes('status') || expr.includes('STATUS') || expr.includes('state')) {
        // Look for guard helper calls like ensureActive(), ensureOwner(), etc.
        const guardHelpers = [
            'ensureActive', 'ensureOwner', 'requireActive', 'requireStatus',
            'onlyActive', 'onlyDeployer',
        ];
        for (const helper of guardHelpers) {
            if (bodyText.includes(helper)) {
                return makeResult(preSpec, 'UNVERIFIED',
                    `Precondition "${expr}" may be enforced by ${helper}() call — needs deeper call-graph analysis`);
            }
        }
    }

    // Extract key terms from the precondition for fuzzy matching
    const keyTerms = extractKeyTerms(expr);

    // Check if any guard condition contains the key terms
    for (const guard of guards) {
        const guardTerms = extractKeyTerms(guard.condition);
        const matchCount = keyTerms.filter((t) => guardTerms.includes(t)).length;
        if (matchCount > 0 && matchCount >= Math.ceil(keyTerms.length * 0.5)) {
            return makeResult(
                preSpec,
                'VERIFIED',
                `Precondition "${expr}" matched by guard: ${guard.condition}`,
            );
        }
    }

    // Check if the body contains the field references mentioned in the precondition
    const fieldRefs = extractFieldRefsFromExpr(expr);
    const bodyHasFields = fieldRefs.every((f) => bodyText.includes(f));
    const bodyHasRevert = bodyText.includes('Revert');

    if (bodyHasFields && bodyHasRevert) {
        return makeResult(
            preSpec,
            'UNVERIFIED',
            `Method references fields from precondition "${expr}" and has Revert, but exact guard match not confirmed`,
        );
    }

    if (bodyHasRevert) {
        return makeResult(
            preSpec,
            'UNVERIFIED',
            `Method has Revert checks but couldn't match to precondition: ${expr}`,
        );
    }

    return makeResult(
        preSpec,
        'VIOLATED',
        `No guard check found for precondition: ${expr}`,
        'Add an if-check that throws Revert when the precondition is violated',
    );
}

/**
 * Verify @post / @ensures specs.
 *
 * For V1, we do structural checks:
 * - If postcondition references a field, check method modifies it
 * - If @ensures CEI, run CEI violation check
 * - old() references are noted but can't be fully verified statically
 */
function verifyPostcondition(
    postSpec: PostconditionSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    storedFields: Set<string>,
): VerificationResult {
    // Special case: @ensures CEI
    if (postSpec.isCEI) {
        return verifyCEI(postSpec, method, sourceFile, storedFields);
    }

    const bodyText = getMethodBodyText(method, sourceFile);

    // Check that referenced fields are actually modified
    if (postSpec.fieldReferences.length > 0) {
        const unmodified: string[] = [];
        for (const field of postSpec.fieldReferences) {
            const writePattern = `this.${field}.value`;
            const setPattern = `this.${field}.set`;
            if (!bodyText.includes(writePattern) && !bodyText.includes(setPattern)) {
                unmodified.push(field);
            }
        }

        if (unmodified.length > 0) {
            return makeResult(
                postSpec,
                'UNVERIFIED',
                `Postcondition references fields [${unmodified.join(', ')}] that are not modified in ${postSpec.methodName}()`,
                'Ensure the method modifies these fields or update the postcondition',
            );
        }
    }

    // Check for return-value postconditions
    if (postSpec.expression.includes('return')) {
        const hasReturn = bodyText.includes('return');
        if (!hasReturn) {
            return makeResult(
                postSpec,
                'VIOLATED',
                `Postcondition references return value but method ${postSpec.methodName}() has no return statement`,
            );
        }
    }

    // old() references need symbolic execution — mark as UNVERIFIED
    if (postSpec.oldReferences.length > 0) {
        return makeResult(
            postSpec,
            'UNVERIFIED',
            `Postcondition uses old() references — requires symbolic execution for full verification`,
            `Fields referenced via old(): ${postSpec.oldReferences.join(', ')}`,
        );
    }

    // If we get here, the postcondition looks structurally consistent
    if (postSpec.fieldReferences.length > 0) {
        return makeResult(
            postSpec,
            'UNVERIFIED',
            `Postcondition "${postSpec.expression}" — fields are modified but value correctness requires symbolic execution`,
        );
    }

    return makeResult(
        postSpec,
        'UNVERIFIED',
        `Postcondition "${postSpec.expression}" — structural check passed but full verification requires symbolic execution`,
    );
}

/**
 * Verify @ensures CEI — Checks-Effects-Interactions pattern.
 */
function verifyCEI(
    spec: PostconditionSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
    storedFields: Set<string>,
): VerificationResult {
    const externalCalls = findBlockchainCalls(method, sourceFile);
    const stateWrites = findStateWrites(method, sourceFile, storedFields);

    if (externalCalls.length === 0) {
        return makeResult(spec, 'VERIFIED', `${spec.methodName}() has no external calls — CEI trivially satisfied`);
    }

    if (stateWrites.length === 0) {
        return makeResult(spec, 'VERIFIED', `${spec.methodName}() has no state writes — CEI trivially satisfied`);
    }

    // Check if any state write comes after any external call
    const violations: string[] = [];
    for (const call of externalCalls) {
        for (const write of stateWrites) {
            if (write.pos > call.pos) {
                violations.push(`State write '${write.text}' after Blockchain.call()`);
            }
        }
    }

    if (violations.length > 0) {
        return makeResult(
            spec,
            'VIOLATED',
            `CEI violation in ${spec.methodName}(): ${violations.join('; ')}`,
            'Move all state writes before external calls',
        );
    }

    return makeResult(spec, 'VERIFIED', `${spec.methodName}() follows CEI pattern — all state writes before external calls`);
}

/**
 * Verify @calls specs — check that the method makes the specified cross-contract calls.
 */
function verifyCalls(
    callSpec: CallsSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): VerificationResult {
    const bodyText = getMethodBodyText(method, sourceFile);
    const externalCalls = findBlockchainCalls(method, sourceFile);

    if (externalCalls.length === 0) {
        return makeResult(
            callSpec,
            'VIOLATED',
            `${callSpec.methodName}() specifies @calls ${callSpec.target} but has no Blockchain.call()`,
        );
    }

    // Check if the target contract address is referenced
    const targetField = callSpec.target.replace(/^this\./, '').replace(/\.value$/, '');
    const targetReferenced = bodyText.includes(callSpec.target) || bodyText.includes(targetField);

    if (!targetReferenced) {
        return makeResult(
            callSpec,
            'VIOLATED',
            `${callSpec.methodName}() specifies @calls to ${callSpec.target} but doesn't reference that target`,
        );
    }

    // Check the method name in the called method (look for selector encoding)
    const calledMethodName = callSpec.calledMethod.replace(/\(.*\)$/, '');
    if (calledMethodName) {
        // Look for the selector or a reference to the method name
        const selectorRef =
            bodyText.includes(calledMethodName) ||
            bodyText.includes(`Selector`) ||
            bodyText.includes(`encodeSelector`);

        if (!selectorRef) {
            return makeResult(
                callSpec,
                'UNVERIFIED',
                `${callSpec.methodName}() calls ${callSpec.target} but couldn't verify method '${calledMethodName}' is being called`,
            );
        }
    }

    // Check must-succeed expectation
    if (callSpec.expectation === 'must-succeed') {
        const checksSuccess =
            bodyText.includes('.success') ||
            bodyText.includes('result.success') ||
            bodyText.includes('Revert');

        if (!checksSuccess) {
            return makeResult(
                callSpec,
                'VIOLATED',
                `${callSpec.methodName}() specifies @calls -> must-succeed but doesn't check call result`,
                'Check result.success and throw Revert on failure',
            );
        }
    }

    return makeResult(
        callSpec,
        'VERIFIED',
        `${callSpec.methodName}() calls ${callSpec.target} with result checking`,
    );
}

/**
 * Verify @state transition specs.
 *
 * For each state transition, check that:
 * 1. The method has a guard for the "from" state
 * 2. The method transitions to the "to" state
 */
function verifyStateTransition(
    stateSpec: StateSpec,
    method: ts.MethodDeclaration,
    sourceFile: ts.SourceFile,
): VerificationResult {
    const bodyText = getMethodBodyText(method, sourceFile);
    const transition = stateSpec.transition;

    // Check if the method has a guard for the from-state
    const fromState = transition.fromState;
    const toState = transition.toState;

    // Negated states: !STATE means "not in STATE"
    const isNegatedFrom = fromState.startsWith('!');
    const cleanFromState = fromState.replace(/^!/, '');
    const isNegatedTo = toState.startsWith('!');
    const cleanToState = toState.replace(/^!/, '');

    // Look for state-related field references in the body
    const stateRelatedTerms = [
        cleanFromState.toLowerCase(),
        cleanToState.toLowerCase(),
        'status',
        'state',
        'graduated',
        'initialized',
        'active',
    ];

    const bodyLower = bodyText.toLowerCase();
    const hasStateRef = stateRelatedTerms.some((t) => bodyLower.includes(t));

    if (!hasStateRef) {
        return makeResult(
            stateSpec,
            'UNVERIFIED',
            `State transition ${fromState} -> ${toState} in ${transition.methods.join(', ')}(): no state-related field references found`,
        );
    }

    // Check for guard (from-state check)
    const hasGuard = bodyText.includes('Revert') || bodyText.includes('throw');
    if (!hasGuard) {
        return makeResult(
            stateSpec,
            'UNVERIFIED',
            `State transition ${fromState} -> ${toState}: method has state references but no guard/revert for invalid states`,
        );
    }

    // Check for condition if specified
    if (transition.condition) {
        const conditionTerms = extractKeyTerms(transition.condition);
        const conditionMatched = conditionTerms.some((t) => bodyLower.includes(t.toLowerCase()));
        if (!conditionMatched) {
            return makeResult(
                stateSpec,
                'UNVERIFIED',
                `State transition condition "${transition.condition}" not found in method body`,
            );
        }
    }

    // If from == to (self-transition), the state shouldn't change
    if (cleanFromState === cleanToState && isNegatedFrom === isNegatedTo) {
        return makeResult(
            stateSpec,
            'UNVERIFIED',
            `Self-transition ${fromState} -> ${toState}: method has state guards but self-transition verification requires deeper analysis`,
        );
    }

    return makeResult(
        stateSpec,
        'UNVERIFIED',
        `State transition ${fromState} -> ${toState}: structural checks pass but full state machine verification requires deeper analysis`,
    );
}

/**
 * Verify @invariant specs.
 *
 * For V1, check that all methods that modify fields mentioned in the invariant
 * have some relationship-preserving logic (very basic).
 */
function verifyInvariant(
    invariant: InvariantSpec,
    classDecl: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    allMethods: Map<string, ts.MethodDeclaration>,
): VerificationResult[] {
    const results: VerificationResult[] = [];

    if (invariant.fieldReferences.length === 0) {
        results.push(
            makeResult(
                invariant,
                'UNVERIFIED',
                `Invariant "${invariant.expression}" references no this.X.value fields — can't verify statically`,
            ),
        );
        return results;
    }

    // Find all methods that modify the invariant's fields
    const modifyingMethods: string[] = [];

    for (const [methodName, method] of allMethods) {
        const bodyText = getMethodBodyText(method, sourceFile);
        for (const field of invariant.fieldReferences) {
            if (bodyText.includes(`this.${field}.value`) || bodyText.includes(`this.${field}.set`)) {
                modifyingMethods.push(methodName);
                break;
            }
        }
    }

    if (modifyingMethods.length === 0) {
        results.push(
            makeResult(
                invariant,
                'VERIFIED',
                `Invariant "${invariant.expression}" — no methods modify the referenced fields (trivially maintained)`,
            ),
        );
        return results;
    }

    // For each modifying method, check if it has guards that could maintain the invariant
    for (const methodName of modifyingMethods) {
        const method = allMethods.get(methodName)!;
        const bodyText = getMethodBodyText(method, sourceFile);
        const hasChecks = bodyText.includes('Revert') || bodyText.includes('throw');

        if (hasChecks) {
            results.push(
                makeResult(
                    invariant,
                    'UNVERIFIED',
                    `Invariant "${invariant.expression}" — ${methodName}() modifies fields [${invariant.fieldReferences.join(', ')}] and has guards, but full invariant maintenance requires symbolic execution`,
                ),
            );
        } else {
            results.push(
                makeResult(
                    invariant,
                    'UNVERIFIED',
                    `Invariant "${invariant.expression}" — ${methodName}() modifies fields [${invariant.fieldReferences.join(', ')}] with NO guard checks`,
                    `Consider adding validation to maintain the invariant in ${methodName}()`,
                ),
            );
        }
    }

    return results;
}

/**
 * Verify @opnet constraint specs.
 */
function verifyOpnetConstraint(
    spec: OpnetSpec,
    classDecl: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
): VerificationResult {
    const classText = classDecl.getText(sourceFile);

    switch (spec.constraint) {
        case 'selectors-sha256': {
            // Check that selectors use encodeSelector() rather than hardcoded hex
            const hasEncodeSelector = classText.includes('encodeSelector');
            const hasHardcodedSelector = /Selector\s*=\s*(?:0x[0-9a-fA-F]+|\d+)/.test(classText);
            if (hasHardcodedSelector && !hasEncodeSelector) {
                return makeResult(
                    spec,
                    'VIOLATED',
                    `Contract uses hardcoded selectors instead of encodeSelector() (SHA256)`,
                    'Replace hardcoded selectors with encodeSelector("methodName")',
                );
            }
            if (hasEncodeSelector) {
                return makeResult(spec, 'VERIFIED', `Contract uses encodeSelector() for SHA256-based selectors`);
            }
            return makeResult(spec, 'UNVERIFIED', `Could not determine selector encoding method`);
        }

        case 'address-two-params': {
            // Check Address.fromString calls have 2 parameters
            const fromStringRe = /Address\.fromString\s*\(([^)]*)\)/g;
            let m: RegExpExecArray | null;
            const violations: string[] = [];
            while ((m = fromStringRe.exec(classText)) !== null) {
                const args = m[1].split(',');
                if (args.length < 2) {
                    violations.push(m[0]);
                }
            }
            if (violations.length > 0) {
                return makeResult(
                    spec,
                    'VIOLATED',
                    `Address.fromString() called with single parameter: ${violations.join(', ')}`,
                    'Use Address.fromString(str, network) with two parameters',
                );
            }
            if (classText.includes('Address.fromString')) {
                return makeResult(spec, 'VERIFIED', `All Address.fromString() calls use two parameters`);
            }
            return makeResult(spec, 'VERIFIED', `No Address.fromString() calls found (constraint trivially satisfied)`);
        }

        case 'no-approve': {
            const hasApprove = /\.approve\s*\(/.test(classText);
            if (hasApprove) {
                return makeResult(
                    spec,
                    'VIOLATED',
                    `Contract uses .approve() — should use increaseAllowance() instead`,
                    'Replace .approve() calls with .increaseAllowance()',
                );
            }
            return makeResult(spec, 'VERIFIED', `Contract does not use .approve()`);
        }

        case 'csv-timelocks': {
            // This would require deeper Bitcoin script analysis — mark UNVERIFIED
            return makeResult(
                spec,
                'UNVERIFIED',
                `CSV timelock verification requires Bitcoin script analysis — not available in static checker`,
            );
        }

        default:
            return makeResult(spec, 'UNVERIFIED', `Unknown @opnet constraint: ${spec.constraint}`);
    }
}

// ============================================================================
// Main Verification Engine
// ============================================================================

/**
 * Verify a single contract's specs against its source code.
 */
export function verifyContract(
    contract: ContractSpecs,
    sourceFile: ts.SourceFile,
): VerificationReport {
    const results: VerificationResult[] = [];

    // Find the matching class declaration
    const classes = findClassDeclarations(sourceFile);
    const classDecl = classes.find((c) => getClassName(c) === contract.className);

    if (!classDecl) {
        // All specs become MISSING
        for (const inv of contract.invariants) {
            results.push(makeResult(inv, 'MISSING', `Class ${contract.className} not found in source`));
        }
        return buildReport(contract, results);
    }

    // Build method map
    const allMethods = new Map<string, ts.MethodDeclaration>();
    for (const method of getClassMethods(classDecl)) {
        allMethods.set(getMethodName(method), method);
    }

    const storedFields = detectStoredFields(classDecl, sourceFile);
    const storedFieldNames = new Set(storedFields.keys());

    // 1. Verify invariants
    for (const invariant of contract.invariants) {
        results.push(...verifyInvariant(invariant, classDecl, sourceFile, allMethods));
    }

    // 2. Verify opnet constraints
    for (const opnet of contract.opnetConstraints) {
        results.push(verifyOpnetConstraint(opnet, classDecl, sourceFile));
    }

    // 3. Verify method-level specs
    for (const [methodName, methodSpecs] of contract.methods) {
        const method = allMethods.get(methodName);

        if (!method) {
            // Method not found — all its specs are MISSING
            if (methodSpecs.access) {
                results.push(makeResult(methodSpecs.access, 'MISSING', `Method ${methodName}() not found in class ${contract.className}`));
            }
            for (const pre of methodSpecs.preconditions) {
                results.push(makeResult(pre, 'MISSING', `Method ${methodName}() not found in class ${contract.className}`));
            }
            for (const post of methodSpecs.postconditions) {
                results.push(makeResult(post, 'MISSING', `Method ${methodName}() not found in class ${contract.className}`));
            }
            for (const call of methodSpecs.calls) {
                results.push(makeResult(call, 'MISSING', `Method ${methodName}() not found in class ${contract.className}`));
            }
            continue;
        }

        // Verify access control
        if (methodSpecs.access) {
            results.push(verifyAccess(methodSpecs.access, method, sourceFile));
        }

        // Verify preconditions
        for (const pre of methodSpecs.preconditions) {
            results.push(verifyPrecondition(pre, method, sourceFile));
        }

        // Verify postconditions
        for (const post of methodSpecs.postconditions) {
            results.push(verifyPostcondition(post, method, sourceFile, storedFieldNames));
        }

        // Verify calls
        for (const call of methodSpecs.calls) {
            results.push(verifyCalls(call, method, sourceFile));
        }

        // Verify state transitions
        for (const st of methodSpecs.stateTransitions) {
            results.push(verifyStateTransition(st, method, sourceFile));
        }

        // Verify temporal specs (UNVERIFIED for V1)
        for (const temp of methodSpecs.temporal) {
            results.push(
                makeResult(
                    temp,
                    'UNVERIFIED',
                    `Temporal property "${temp.condition}" requires runtime monitoring — not verifiable statically in V1`,
                ),
            );
        }
    }

    // 4. Verify contract-level state transitions (not already tied to a method)
    for (const st of contract.stateTransitions) {
        // Check if already verified as part of a method
        const alreadyVerified = results.some(
            (r) => r.spec === st,
        );
        if (alreadyVerified) continue;

        // Try to find methods in the transition
        for (const methodName of st.transition.methods) {
            const method = allMethods.get(methodName);
            if (method) {
                results.push(verifyStateTransition(st, method, sourceFile));
            } else {
                results.push(makeResult(st, 'MISSING', `State transition method ${methodName}() not found`));
            }
        }
    }

    return buildReport(contract, results);
}

/**
 * Verify specs from a file path.
 */
export function verifyFile(filePath: string, specTree: { contracts: ContractSpecs[] }): VerificationReport[] {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const sourceFile = createSourceFile(absolutePath, source);

    const reports: VerificationReport[] = [];
    for (const contract of specTree.contracts) {
        if (path.resolve(contract.file) === absolutePath) {
            reports.push(verifyContract(contract, sourceFile));
        }
    }

    return reports;
}

// ============================================================================
// Helper Functions
// ============================================================================

function makeResult(
    spec: SpecAnnotation,
    status: VerificationStatus,
    message: string,
    details?: string,
): VerificationResult {
    return {
        spec,
        status,
        message,
        details,
        file: spec.file,
        line: spec.line,
    };
}

function buildReport(contract: ContractSpecs, results: VerificationResult[]): VerificationReport {
    const summary = { verified: 0, unverified: 0, violated: 0, missing: 0, total: results.length };
    for (const r of results) {
        switch (r.status) {
            case 'VERIFIED':
                summary.verified++;
                break;
            case 'UNVERIFIED':
                summary.unverified++;
                break;
            case 'VIOLATED':
                summary.violated++;
                break;
            case 'MISSING':
                summary.missing++;
                break;
        }
    }
    return {
        contractName: contract.className,
        file: contract.file,
        results,
        summary,
    };
}

function extractKeyTerms(expr: string): string[] {
    return expr
        .replace(/[!()=<>]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .map((t) => t.replace(/^this\./, '').replace(/\.value$/, ''));
}

function stripComments(text: string): string {
    // Remove single-line comments
    let result = text.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    return result;
}

function extractFieldRefsFromExpr(expr: string): string[] {
    const refs: string[] = [];
    const re = /this\.(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
        refs.push(`this.${m[1]}`);
    }
    return refs;
}
