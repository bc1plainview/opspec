// ============================================================================
// opspec Types — Core data structures for the specification language
// ============================================================================

/**
 * All recognized spec annotation tags.
 */
export type SpecTag =
    | 'invariant'
    | 'pre'
    | 'requires'    // alias for pre
    | 'post'
    | 'ensures'     // alias for post (or CEI keyword)
    | 'state'
    | 'access'
    | 'calls'
    | 'temporal'
    | 'opnet';

/**
 * Verification result status for a single spec.
 */
export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'VIOLATED' | 'MISSING';

/**
 * A single parsed spec annotation extracted from a JSDoc comment.
 */
export interface SpecAnnotation {
    /** The tag type (invariant, pre, post, etc.) */
    tag: SpecTag;

    /** Raw expression text after the tag */
    expression: string;

    /** Optional inline comment (after //) */
    comment?: string;

    /** Source location */
    file: string;
    line: number;
    column: number;
}

/**
 * An invariant applies to the entire contract.
 */
export interface InvariantSpec extends SpecAnnotation {
    tag: 'invariant';
    /** Parsed field references in the expression (e.g., this.graduated.value) */
    fieldReferences: string[];
}

/**
 * A precondition for a method.
 */
export interface PreconditionSpec extends SpecAnnotation {
    tag: 'pre' | 'requires';
    /** The method this precondition applies to */
    methodName: string;
}

/**
 * A postcondition for a method.
 */
export interface PostconditionSpec extends SpecAnnotation {
    tag: 'post' | 'ensures';
    /** The method this postcondition applies to */
    methodName: string;
    /** Whether this is the special "CEI" ensures pattern */
    isCEI: boolean;
    /** Fields referenced via old() */
    oldReferences: string[];
    /** Fields referenced in the postcondition */
    fieldReferences: string[];
}

/**
 * A state machine transition specification.
 */
export interface StateTransition {
    fromState: string;
    toState: string;
    methods: string[];
    condition?: string;
}

export interface StateSpec extends SpecAnnotation {
    tag: 'state';
    transition: StateTransition;
}

/**
 * Access control specification.
 */
export type AccessLevel = 'deployer-only' | 'owner-only' | 'anyone' | string;

export interface AccessSpec extends SpecAnnotation {
    tag: 'access';
    level: AccessLevel;
    methodName: string;
}

/**
 * Cross-contract call specification.
 */
export interface CallsSpec extends SpecAnnotation {
    tag: 'calls';
    /** Target contract reference (e.g., this.pillAddress.value) */
    target: string;
    /** Method being called (e.g., transferFrom(sender, this, amount)) */
    calledMethod: string;
    /** Result expectation (must-succeed, may-fail, etc.) */
    expectation: string;
    /** The method this applies to */
    methodName: string;
}

/**
 * Temporal/block property specification.
 */
export interface TemporalSpec extends SpecAnnotation {
    tag: 'temporal';
    /** The referenced method or state */
    subject: string;
    /** Raw temporal condition */
    condition: string;
}

/**
 * OPNet-specific constraint.
 */
export type OpnetConstraint =
    | 'selectors-sha256'
    | 'csv-timelocks'
    | 'address-two-params'
    | 'no-approve';

export interface OpnetSpec extends SpecAnnotation {
    tag: 'opnet';
    constraint: OpnetConstraint | string;
}

/**
 * All method-level specs grouped together.
 */
export interface MethodSpecs {
    methodName: string;
    preconditions: PreconditionSpec[];
    postconditions: PostconditionSpec[];
    access?: AccessSpec;
    calls: CallsSpec[];
    stateTransitions: StateSpec[];
    temporal: TemporalSpec[];
}

/**
 * All specs for a contract class.
 */
export interface ContractSpecs {
    className: string;
    file: string;
    invariants: InvariantSpec[];
    stateTransitions: StateSpec[];
    opnetConstraints: OpnetSpec[];
    methods: Map<string, MethodSpecs>;
}

/**
 * The complete spec tree for a file or directory.
 */
export interface SpecTree {
    contracts: ContractSpecs[];
    /** Raw annotations that couldn't be associated with a contract */
    unassociated: SpecAnnotation[];
}

/**
 * A single verification result.
 */
export interface VerificationResult {
    /** Which spec was being verified */
    spec: SpecAnnotation;
    /** Verification outcome */
    status: VerificationStatus;
    /** Human-readable message explaining the result */
    message: string;
    /** Additional details or evidence */
    details?: string;
    /** Source file */
    file: string;
    /** Line of the spec annotation */
    line: number;
}

/**
 * Complete verification report for a contract.
 */
export interface VerificationReport {
    contractName: string;
    file: string;
    results: VerificationResult[];
    summary: {
        verified: number;
        unverified: number;
        violated: number;
        missing: number;
        total: number;
    };
}

/**
 * Spec coverage information.
 */
export interface CoverageInfo {
    file: string;
    contractName: string;
    totalMethods: number;
    specifiedMethods: number;
    totalFields: number;
    invariantCoveredFields: number;
    methods: {
        name: string;
        hasPreConditions: boolean;
        hasPostConditions: boolean;
        hasAccessSpec: boolean;
        hasCallsSpec: boolean;
        hasCEI: boolean;
    }[];
}
