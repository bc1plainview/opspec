# opspec + opnet-analyzer Integration

## Overview

`opspec` and `opnet-analyzer` are companion tools for OPNet smart contract quality:

| Tool | Purpose | Approach |
|------|---------|----------|
| **opnet-analyzer** | Bug detection, anti-pattern linting | Rule-based static analysis |
| **opspec** | Formal specification & verification | Spec-driven static verification |

They share the same TypeScript Compiler API infrastructure for AST parsing and can be run together in CI pipelines.

## Complementary Checks

### Checks that overlap (shared verification)

| Check | opnet-analyzer | opspec |
|-------|---------------|--------|
| CEI violations | `cei-violation` rule | `@ensures CEI` annotation |
| Missing access control | `missing-access-control` rule | `@access deployer-only/anyone` |
| EVM selectors | `evm-selectors` rule | `@opnet selectors-sha256` |
| Single-param Address.fromString | `single-param-address-fromstring` rule | `@opnet address-two-params` |
| approve() usage | `approve-instead-of-increaseallowance` rule | `@opnet no-approve` |

### Checks unique to opnet-analyzer

- Raw u256 arithmetic (missing SafeMath)
- Pointer collision detection
- Missing `super.onDeployment()` call
- Unbounded loops
- Unchecked calldata reads
- Missing revert checks
- Empty BytesWriter
- While loop warnings
- Large storage count
- Missing event emission
- No reentrancy guard
- Hardcoded addresses

### Checks unique to opspec

- Contract invariants (`@invariant`)
- Method preconditions (`@pre`)
- Method postconditions (`@post`, `old()`)
- State machine specifications (`@state`)
- Cross-contract call verification (`@calls`)
- Temporal properties (`@temporal`)
- Spec coverage analysis
- Auto-generated spec templates

## Recommended CI Pipeline

```yaml
# .github/workflows/contract-quality.yml
name: Contract Quality
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run opnet-analyzer
        run: npx opnet-analyzer src/ --severity medium --fix-suggestions
        continue-on-error: false

      - name: Check opspec syntax
        run: npx opspec check src/

      - name: Verify specifications
        run: npx opspec verify src/

      - name: Spec coverage report
        run: npx opspec coverage src/
```

## Workflow

### 1. Start with opnet-analyzer
Run `opnet-analyzer` first to catch low-hanging bugs and anti-patterns. Fix all critical and high findings before writing specs.

### 2. Generate spec templates
Use `opspec template` to auto-generate starter annotations:

```bash
opspec template src/MyContract.ts > specs-template.txt
```

Review the generated templates and refine them with your contract's actual invariants and requirements.

### 3. Add specs to source
Copy the refined annotations into your source code as `///` comments before the relevant classes and methods.

### 4. Verify continuously
Run `opspec verify` on every commit. Track the verification status:
- **VERIFIED**: Confirmed by static analysis ✓
- **UNVERIFIED**: Needs symbolic execution (V2) or manual review ?
- **VIOLATED**: Fix the code or update the spec ✗
- **MISSING**: Code structure doesn't match spec ○

### 5. Improve coverage
Use `opspec coverage` to identify under-specified methods and add annotations.

## Shared Architecture

Both tools use TypeScript's Compiler API (`ts.createSourceFile`) for AST parsing:

```
┌─────────────────────────────────┐
│         TypeScript AST          │
│   (ts.createSourceFile)         │
├────────────────┬────────────────┤
│                │                │
│  opnet-analyzer│    opspec      │
│  ┌──────────┐  │  ┌──────────┐  │
│  │  Rules   │  │  │  Parser  │  │
│  │ (17+)    │  │  │ (specs)  │  │
│  └────┬─────┘  │  └────┬─────┘  │
│       │        │       │        │
│  ┌────▼─────┐  │  ┌────▼─────┐  │
│  │ Findings │  │  │ Verifier │  │
│  └────┬─────┘  │  └────┬─────┘  │
│       │        │       │        │
│  ┌────▼─────┐  │  ┌────▼─────┐  │
│  │Formatter │  │  │ Reporter │  │
│  └──────────┘  │  └──────────┘  │
└────────────────┴────────────────┘
```

## Future Integration (V2+)

- Shared AST cache between tools
- Combined report output
- opnet-analyzer findings auto-generating opspec annotations
- Symbolic execution engine using opspec annotations as proof obligations
