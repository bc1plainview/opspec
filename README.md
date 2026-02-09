# opspec — OPNet Specification Language & Verifier

A formal specification language and static verifier for OPNet AssemblyScript smart contracts. Write formal specs as structured annotations directly in your contract source files, and the verifier checks that the code satisfies those specs.

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Generate spec templates for an existing contract
npx opspec template src/MyContract.ts

# Verify specs against code
npx opspec verify src/MyContract.ts

# Check spec syntax
npx opspec check src/MyContract.ts

# Show spec coverage
npx opspec coverage src/
```

## What It Does

opspec lets you write formal specifications as `///` annotations directly in your AssemblyScript smart contracts:

```typescript
/// @invariant this.totalSupply.value >= u256.Zero
/// @opnet selectors-sha256
/// @opnet no-approve
@final
export class MyToken extends OP_20 {

    /// @access deployer-only
    /// @pre amount > u256.Zero
    public mint(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        // ...
    }

    /// @access anyone
    /// @pre !this.paused.value  // "Contract is paused"
    /// @post this.balance.value >= old(this.balance.value)
    /// @calls this.tokenAddress.value : transfer(recipient, amount) -> must-succeed
    /// @ensures CEI
    public deposit(calldata: Calldata): BytesWriter {
        // ...
    }
}
```

The verifier then checks these specs against the actual code:

```
═══════════════════════════════════════════════════════════
  opspec — OPNet Specification Verifier
═══════════════════════════════════════════════════════════

MyToken — src/MyToken.ts

  @access
    ✓ VERIFIED    Method mint() has onlyDeployer check
    ✓ VERIFIED    Method deposit() has no access restrictions

  @pre
    ✓ VERIFIED    Precondition "!this.paused.value" matched by guard
    ✓ VERIFIED    Precondition "amount > u256.Zero" matched by guard

  @ensures
    ✓ VERIFIED    deposit() follows CEI pattern

  Summary: 5 verified · 0 violated  (5 total)
```

## Specification Constructs

### Contract-Level

| Annotation | Purpose | Example |
|-----------|---------|---------|
| `@invariant` | Property that holds for all states | `@invariant this.balance.value >= u256.Zero` |
| `@state` | State machine transition | `@state ACTIVE -> PAUSED : pause()` |
| `@opnet` | OPNet-specific constraint | `@opnet selectors-sha256` |

### Method-Level

| Annotation | Purpose | Example |
|-----------|---------|---------|
| `@pre` / `@requires` | Precondition | `@pre !amount.isZero()` |
| `@post` / `@ensures` | Postcondition | `@post balance >= old(balance)` |
| `@ensures CEI` | CEI pattern enforcement | `@ensures CEI` |
| `@access` | Access control | `@access deployer-only` |
| `@calls` | Cross-contract call spec | `@calls target : transfer(...) -> must-succeed` |
| `@temporal` | Temporal property | `@temporal heartbeat() within 100 blocks` |

## CLI Commands

### `opspec verify <path>`
Verify spec annotations against code. Returns exit code 1 if violations found.

```bash
opspec verify src/MyContract.ts        # Single file
opspec verify src/                     # Directory (recursive)
opspec verify src/ --json              # JSON output
```

### `opspec check <file>`
Parse and validate spec syntax without verifying against code.

```bash
opspec check src/MyContract.ts
opspec check src/MyContract.ts --json
```

### `opspec extract <file>`
Extract all specs as structured JSON data.

```bash
opspec extract src/MyContract.ts
```

### `opspec coverage <path>`
Show which methods and fields have spec annotations.

```bash
opspec coverage src/MyContract.ts
opspec coverage src/ --json
```

### `opspec template <file>`
Auto-generate spec annotation templates from code analysis. This is the **recommended starting point** — it reads your contract and generates starter annotations.

```bash
opspec template src/MyContract.ts            # Comment-style output
opspec template src/MyContract.ts --json     # JSON output
opspec template src/MyContract.ts --annotate # Source with annotations inserted
```

The template generator detects:
- Access control patterns (onlyDeployer, ensureOwner → `@access deployer-only`)
- Zero-check guards → `@pre` annotations
- State field reads/writes → `@state` machine templates
- Cross-contract calls → `@calls` annotations
- External call presence → `@ensures CEI` recommendations

## Verification Results

| Status | Icon | Meaning |
|--------|------|---------|
| **VERIFIED** | ✓ | Spec confirmed by static analysis |
| **UNVERIFIED** | ? | Needs symbolic execution or manual review |
| **VIOLATED** | ✗ | Code clearly violates the spec |
| **MISSING** | ○ | Referenced code structure not found |

## What Gets Verified in V1 (Static)

| Check | Verification Level |
|-------|-------------------|
| `@access deployer-only` | **Full** — checks for onlyDeployer() call |
| `@access anyone` | **Full** — checks no access restrictions |
| `@ensures CEI` | **Full** — checks state write ordering vs external calls |
| `@opnet selectors-sha256` | **Full** — checks encodeSelector() usage |
| `@opnet no-approve` | **Full** — checks no .approve() calls |
| `@opnet address-two-params` | **Full** — checks Address.fromString() args |
| `@pre` (guard matching) | **Heuristic** — matches guards to preconditions |
| `@calls` | **Structural** — checks Blockchain.call() presence and result checking |
| `@post` | **Structural** — checks field modification, can't verify values |
| `@invariant` | **Structural** — checks modifying methods have guards |
| `@state` | **Structural** — checks state references and guards |
| `@temporal` | **Informational** — documented but not verified |

## Design Philosophy

1. **Specs live with the code** — No separate .spec files. Annotations are JSDoc-style comments in the source.
2. **Mathematical, not code** — Spec expressions use `>=` and `+` even though code needs `SafeMath.add()`.
3. **`old()` for pre-state** — Standard postcondition keyword (from JML/Dafny).
4. **Honest about limitations** — UNVERIFIED is better than a false VERIFIED. V1 is conservative.
5. **Templates lower the barrier** — Auto-generate specs from code patterns to make adoption easy.

## Integration with opnet-analyzer

opspec is a companion to [opnet-analyzer](../opnet-analyzer). They share the TypeScript AST parsing infrastructure and have complementary checks. See [docs/integration.md](docs/integration.md) for details.

## Documentation

- [Grammar Reference](docs/grammar.md) — Formal grammar for all spec constructs
- [Examples](docs/examples.md) — Annotated contract examples
- [Integration Guide](docs/integration.md) — Using opspec with opnet-analyzer

## Project Structure

```
opspec/
├── src/
│   ├── cli.ts                 # CLI entry point
│   ├── spec-parser.ts         # Parses spec annotations from AST
│   ├── verifier.ts            # Static verification engine
│   ├── reporter.ts            # Formats verification results
│   ├── template-generator.ts  # Auto-generates spec templates
│   ├── coverage.ts            # Spec coverage analysis
│   ├── ast-utils.ts           # Shared AST utilities
│   ├── types.ts               # Type definitions
│   └── index.ts               # Library exports
├── test/
│   ├── annotated-good.ts      # Contract that passes all checks
│   ├── annotated-violations.ts # Contract with deliberate violations
│   ├── opsea-annotated.ts     # NFT Marketplace with specs
│   └── deadman-annotated.ts   # Dead Man's Switch with specs
├── docs/
│   ├── grammar.md             # Formal spec language grammar
│   ├── examples.md            # Annotated contract examples
│   └── integration.md         # opnet-analyzer integration guide
├── package.json
├── tsconfig.json
└── README.md
```

## V1 Limitations

- **Static analysis only** — No symbolic execution engine. Some checks return UNVERIFIED.
- **Intra-procedural** — Verifier checks individual methods, not call chains between helper functions.
- **No quantifiers** — `forall`/`exists` are reserved for V2.
- **No runtime instrumentation** — Specs are checked at build time, not runtime.

## Roadmap

- **V2**: Symbolic execution engine for `old()` postconditions and invariant proof
- **V2**: Inter-procedural analysis (follow helper function calls)
- **V2**: Quantifier support in invariants
- **V3**: Runtime assertion injection (compile specs into runtime checks)
- **V3**: Model checking for state machine reachability
